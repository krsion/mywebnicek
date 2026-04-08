/**
 * DenicekDocument - Document abstraction backed by @mydenicek/core CRDT engine.
 * Wraps the Denicek class with an inline adapter that maps selector-based
 * operations to the ID-based tree API the React UI expects.
 */

import { Denicek } from "@jsr/mydenicek__core";
import type { PlainNode, PlainRecord } from "@jsr/mydenicek__core";

import type {
    GeneralizedPatch,
    GroupedPatch,
    NodeData,
    Snapshot,
    SyncState,
    SyncStatus,
    Version,
} from "./types.js";

// ── NodeInput ────────────────────────────────────────────────────────

export type NodeInput =
    | { kind: "element"; tag: string; attrs?: Record<string, unknown>; children?: NodeInput[] }
    | { kind: "value"; value: string }
    | { kind: "action"; label: string; actions: GeneralizedPatch[]; params?: Record<string, string> }
    | { kind: "ref"; target: string }
    | { kind: "formula"; operation: string };

// ── Options & Sync ───────────────────────────────────────────────────

export interface DenicekDocumentOptions {
    peerId?: string;
    onVersionChange?: (version: number) => void;
    maxUndoSteps?: number;
    mergeInterval?: number;
}

export interface SyncOptions {
    url: string;
    roomId: string;
    pingIntervalMs?: number;
}

// ── Inline adapter helpers ───────────────────────────────────────────

const META = new Set(["$tag", "$id", "$kind", "$order"]);

function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && !Array.isArray(v)
        && "$tag" in v && !("$ref" in v) && !("$items" in v);
}

// ── DenicekDocument ──────────────────────────────────────────────────

export class DenicekDocument {
    private dk: Denicek;
    private ni = new Map<string, NodeData>();
    private ci = new Map<string, string[]>();
    private pi = new Map<string, string | null>();
    private sp = new Map<string, string>();   // id -> selector
    private rid: string | null = null;
    private _v = 0;
    private listeners = new Set<() => void>();
    private onVC?: (v: number) => void;
    private _ss: SyncStatus = "idle";
    private _sl: number | undefined;
    private _sr: string | null = null;
    private _se: string | null = null;
    private ssl = new Set<(s: SyncState) => void>();

    constructor(options?: DenicekDocumentOptions) {
        const peer = options?.peerId ?? crypto.randomUUID();
        this.onVC = options?.onVersionChange;
        this.dk = new Denicek(peer);
        this.rebuild();
    }

    static create(
        options?: DenicekDocumentOptions,
        initializer?: (doc: DenicekDocument) => void,
    ): DenicekDocument {
        const doc = new DenicekDocument(options);
        if (initializer) initializer(doc);
        return doc;
    }

    // ── Read API ─────────────────────────────────────────────────

    getNode(id: string): NodeData | null { return this.ni.get(id) ?? null; }
    getChildIds(p: string): string[] { return this.ci.get(p) ?? []; }
    getParentId(n: string): string | null { return this.pi.get(n) ?? null; }
    getRootId(): string | null { return this.rid; }
    getAllNodes(): Record<string, NodeData> {
        const r: Record<string, NodeData> = {};
        for (const [k, v] of this.ni) r[k] = v;
        return r;
    }

    /** Expose the underlying Denicek for direct selector-based operations. */
    get denicekInstance(): Denicek { return this.dk; }

    // ── Mutations ────────────────────────────────────────────────

    createRootNode(tag: string): string {
        const id = crypto.randomUUID();
        this.dk.add("", "root", { $tag: tag, $id: id, $kind: "element", $order: "" } as unknown as PlainRecord);
        this.mut(); return id;
    }

    addChildren(parentId: string, children: NodeInput[], startIndex?: number): string[] {
        const pp = this.rp(parentId); const ids: string[] = [];
        for (const c of children) {
            const id = crypto.randomUUID();
            this.dk.add(pp, id, this.toRec(c, id) as unknown as PlainRecord);
            ids.push(id);
        }
        this.insOrd(pp, ids, startIndex); this.mut(); return ids;
    }

    deleteNodes(nodeIds: string[]): void {
        for (const id of nodeIds) {
            const pid = this.pi.get(id); if (pid == null) continue;
            const pp = this.sp.get(pid); if (pp == null) continue;
            this.dk.delete(pp, id); this.rmOrd(pp, id);
        }
        this.mut();
    }

    moveNodes(nodeIds: string[], newParentId: string, index?: number): void {
        for (const id of nodeIds) {
            const pid = this.pi.get(id); if (pid == null) continue;
            const pp = this.sp.get(pid); if (pp == null) continue;
            // Snapshot subtree from materialized doc before deleting
            const doc = this.dk.materialize() as PlainRecord;
            const sub = this.navPlain(doc, pp + "/" + id);
            if (!sub) continue;
            this.dk.delete(pp, id); this.rmOrd(pp, id);
            const np = this.rp(newParentId);
            this.dk.add(np, id, sub as PlainRecord);
        }
        this.insOrd(this.rp(newParentId), nodeIds, index); this.mut();
    }

    updateAttribute(nodeIds: string[], key: string, value: unknown | undefined): void {
        for (const id of nodeIds) {
            const p = this.rp(id);
            if (value === undefined) { this.dk.delete(p, key); }
            else {
                // Check if field exists using our index
                const node = this.ni.get(id);
                const exists = node?.kind === "element" && key in node.attrs;
                if (exists) this.dk.set(p + "/" + key, value as string | number | boolean);
                else this.dk.add(p, key, value as string | number | boolean);
            }
        }
        this.mut();
    }

    updateTag(nodeIds: string[], newTag: string): void {
        for (const id of nodeIds) this.dk.updateTag(this.rp(id), newTag);
        this.mut();
    }

    spliceValue(nodeIds: string[], _i: number, _d: number, text: string): void {
        for (const id of nodeIds) this.dk.set(this.rp(id) + "/value", text);
        this.mut();
    }

    updateValue(nodeIds: string[], _old: string, nv: string): void {
        for (const id of nodeIds) this.dk.set(this.rp(id) + "/value", nv);
        this.mut();
    }

    updateFormulaOperation(id: string, op: string): void {
        this.dk.set(this.rp(id) + "/operation", op); this.mut();
    }

    updateRefTarget(id: string, t: string): void {
        this.dk.set(this.rp(id) + "/target", t); this.mut();
    }

    updateNodeProperty(id: string, prop: string, val: unknown): void {
        this.updateAttribute([id], prop, val);
    }

    copyNode(sourceId: string, parentId: string, opts?: { index?: number }): string {
        const n = this.ni.get(sourceId);
        if (!n) throw new Error(`Node not found: ${sourceId}`);
        const ids = this.addChildren(parentId, [this.toInput(n)], opts?.index);
        return ids[0] ?? sourceId;
    }

    appendActions(_id: string, _a: GeneralizedPatch[]): void { /* TODO */ }
    deleteAction(_id: string, _i: number): void { /* TODO */ }
    moveAction(_id: string, _f: number, _t: number): void { /* TODO */ }
    commit(_o?: string): void { /* auto-commits */ }

    // ── Undo/Redo (stubbed — not yet in published @mydenicek/core) ──

    undo(): boolean { return false; }
    redo(): boolean { return false; }
    get canUndo(): boolean { return false; }
    get canRedo(): boolean { return false; }
    clearUndoHistory(): void { /* TODO */ }

    // ── Version & Subscribe ──────────────────────────────────────

    get currentVersion(): number { return this._v; }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener); return () => this.listeners.delete(listener);
    }

    // ── Sync (stubbed) ───────────────────────────────────────────

    async connectToSync(_o: SyncOptions): Promise<void> {
        this.ssSet("disconnected", "Sync migration in progress");
    }
    async disconnectSync(): Promise<void> { this.ssSet("idle"); }
    get isSyncConnected(): boolean { return this._ss === "connected"; }
    get syncRoomId(): string | null { return this._sr; }
    getSyncState(): SyncState {
        return { status: this._ss, latency: this._sl, roomId: this._sr, error: this._se };
    }
    onSyncStateChange(l: (s: SyncState) => void): () => void {
        this.ssl.add(l); l(this.getSyncState()); return () => this.ssl.delete(l);
    }

    // ── Peer (stubbed) ───────────────────────────────────────────

    getPeerId(): string { return this.dk.peer; }
    setPeerName(_n: string): void { }
    getPeerNames(): Record<string, string> { return {}; }
    onPeerNamesChange(l: (n: Record<string, string>) => void): () => void { l({}); return () => {}; }

    // ── History (stubbed) ────────────────────────────────────────

    getHistory(): GeneralizedPatch[] { return []; }
    getGroupedHistory(): GroupedPatch[] { return []; }
    clearHistory(): void { }
    replay(_s: GeneralizedPatch[], _p: Record<string, string>): void { }

    // ── Snapshot ─────────────────────────────────────────────────

    getSnapshot(): Snapshot {
        const nodes = new Map<string, NodeData>();
        const parents = new Map<string, string | null>();
        const childIds = new Map<string, readonly string[]>();
        for (const [id, nd] of this.ni) {
            nodes.set(id, nd); parents.set(id, this.pi.get(id) ?? null);
            childIds.set(id, this.ci.get(id) ?? []);
        }
        return { nodes, parents, childIds, rootId: this.rid };
    }

    // ── Import/Export (stubbed) ──────────────────────────────────

    export(_m: "update" | "snapshot", _f?: Version): Uint8Array { return new Uint8Array(); }
    import(_b: Uint8Array): void { }
    getVersion(): Version { return []; }
    toJSON(): object { return this.getAllNodes(); }
    dispose(): void { }

    // ── Private: index rebuild ───────────────────────────────────

    private rebuild(): void {
        this.ni.clear(); this.ci.clear(); this.pi.clear(); this.sp.clear(); this.rid = null;
        const doc = this.dk.materialize();
        if (!isRec(doc)) return;
        const root = doc["root"];
        if (root === undefined || !isRec(root)) return;
        this.idxRec(root, "root", null);
    }

    private idxRec(rec: PlainRecord, sel: string, parentId: string | null): void {
        const id = rec["$id"] as string | undefined;
        const kind = rec["$kind"] as string | undefined;
        if (!id || !kind) return;
        this.sp.set(id, sel); this.pi.set(id, parentId);
        if (parentId === null) this.rid = id;
        switch (kind) {
            case "element": this.idxElem(rec, id, sel); break;
            case "value":
                this.ni.set(id, { id, kind: "value", value: rec["value"] as string | number }); break;
            case "action":
                this.ni.set(id, {
                    id, kind: "action", label: rec["label"] as string,
                    actions: JSON.parse((rec["actions"] as string) || "[]"),
                    params: JSON.parse((rec["params"] as string) || "{}"),
                }); break;
            case "ref":
                this.ni.set(id, { id, kind: "ref", target: rec["target"] as string }); break;
            case "formula":
                this.ni.set(id, { id, kind: "formula", operation: rec["operation"] as string }); break;
        }
    }

    private idxElem(rec: PlainRecord, id: string, sel: string): void {
        const attrs: Record<string, unknown> = {};
        const kids: string[] = [];
        const ordStr = rec["$order"] as string | undefined;
        const ord = ordStr ? ordStr.split(",").filter(Boolean) : [];
        const childRecs = new Map<string, PlainRecord>();
        for (const key of Object.keys(rec)) {
            if (META.has(key)) continue;
            const v = rec[key];
            if (v === undefined) continue;
            if (isRec(v)) childRecs.set(key, v); else attrs[key] = v;
        }
        for (const ck of ord) {
            const cr = childRecs.get(ck);
            if (cr) { kids.push(ck); this.idxRec(cr, sel + "/" + ck, id); }
        }
        for (const [ck, cr] of childRecs) {
            if (!ord.includes(ck)) { kids.push(ck); this.idxRec(cr, sel + "/" + ck, id); }
        }
        this.ni.set(id, { id, kind: "element", tag: rec["$tag"] as string, attrs });
        this.ci.set(id, kids);
    }

    // ── Private: mutation helpers ─────────────────────────────────

    private toRec(input: NodeInput, id: string): PlainRecord {
        switch (input.kind) {
            case "element": {
                const r: PlainRecord = { $tag: input.tag, $id: id, $kind: "element", $order: "" };
                if (input.attrs) for (const [k, v] of Object.entries(input.attrs)) r[k] = v as string;
                if (input.children?.length) {
                    const cids: string[] = [];
                    for (const c of input.children) {
                        const cid = crypto.randomUUID(); cids.push(cid);
                        r[cid] = this.toRec(c, cid);
                    }
                    r["$order"] = cids.join(",");
                }
                return r;
            }
            case "value": return { $tag: "$value", $id: id, $kind: "value", value: input.value };
            case "action": return {
                $tag: "$action", $id: id, $kind: "action",
                label: input.label, actions: JSON.stringify(input.actions),
                params: JSON.stringify(input.params ?? {}),
            };
            case "ref": return { $tag: "$ref", $id: id, $kind: "ref", target: input.target };
            case "formula": return { $tag: "$formula", $id: id, $kind: "formula", operation: input.operation };
        }
    }

    private rp(id: string): string {
        const p = this.sp.get(id); if (!p) throw new Error(`Node not found: ${id}`); return p;
    }

    private readOrd(pp: string): string[] {
        // Navigate the materialized tree to read $order
        const doc = this.dk.materialize() as PlainRecord;
        const node = this.navPlain(doc, pp);
        if (!node || !isRec(node)) return [];
        const s = node["$order"] as string | undefined;
        return s ? s.split(",").filter(Boolean) : [];
    }

    private insOrd(pp: string, ids: string[], idx?: number): void {
        const o = this.readOrd(pp);
        const i = idx !== undefined ? Math.min(idx, o.length) : o.length;
        o.splice(i, 0, ...ids);
        this.dk.set(pp + "/$order", o.join(","));
    }

    private rmOrd(pp: string, cid: string): void {
        const o = this.readOrd(pp).filter(x => x !== cid);
        this.dk.set(pp + "/$order", o.join(","));
    }

    private mut(): void {
        this._v++; this.rebuild();
        this.onVC?.(this._v);
        for (const l of this.listeners) l();
    }

    private toInput(n: NodeData): NodeInput {
        switch (n.kind) {
            case "element": return { kind: "element", tag: n.tag, attrs: { ...n.attrs } };
            case "value": return { kind: "value", value: String(n.value) };
            case "action": return { kind: "action", label: n.label, actions: n.actions, params: n.params };
            case "ref": return { kind: "ref", target: n.target };
            case "formula": return { kind: "formula", operation: n.operation };
        }
    }

    private navPlain(root: PlainNode, path: string): PlainNode | undefined {
        const segs = path.split("/").filter(Boolean);
        let cur: PlainNode = root;
        for (const seg of segs) {
            if (!isRec(cur)) return undefined;
            const child = cur[seg];
            if (child === undefined) return undefined;
            cur = child;
        }
        return cur;
    }

    private ssSet(s: SyncStatus, e?: string): void {
        this._ss = s; this._se = e ?? null;
        const st = this.getSyncState();
        for (const l of this.ssl) l(st);
    }
}
