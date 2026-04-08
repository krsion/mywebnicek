/**
 * DenicekDocument - Document abstraction backed by the Denicek CRDT.
 * Uses Denicek directly (bypassing DocumentAdapter's $order mechanism)
 * and maintains its own ID-based indexes for the React UI.
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

export type NodeInput =
    | { kind: "element"; tag: string; attrs?: Record<string, unknown>; children?: NodeInput[] }
    | { kind: "value"; value: string }
    | { kind: "action"; label: string; actions: GeneralizedPatch[]; params?: Record<string, string> }
    | { kind: "ref"; target: string }
    | { kind: "formula"; operation: string };

export interface DenicekDocumentOptions {
    peerId?: string;
    onVersionChange?: (version: number) => void;
    maxUndoSteps?: number;
    mergeInterval?: number;
}

export interface SyncOptions { url: string; roomId: string; pingIntervalMs?: number; }

const META = new Set(["$tag", "$id", "$kind"]);
function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && !Array.isArray(v)
        && "$tag" in v && !("$ref" in v) && !("$items" in v);
}

export class DenicekDocument {
    private dk: Denicek;
    private ni = new Map<string, NodeData>();
    private ci = new Map<string, string[]>();
    private pi = new Map<string, string | null>();
    private sp = new Map<string, string>();
    private rid: string | null = null;
    private _v = 0;
    private lsnrs = new Set<() => void>();
    private onVC?: (v: number) => void;
    private _ss: SyncStatus = "idle";
    private _se: string | null = null;
    private ssl = new Set<(s: SyncState) => void>();

    constructor(options?: DenicekDocumentOptions) {
        this.dk = new Denicek(options?.peerId ?? crypto.randomUUID());
        this.onVC = options?.onVersionChange;
    }

    static create(options?: DenicekDocumentOptions, init?: (d: DenicekDocument) => void): DenicekDocument {
        const d = new DenicekDocument(options);
        if (init) init(d);
        d.rebuild();
        return d;
    }

    // ── Read ─────────────────────────────────────────────────────
    getNode(id: string): NodeData | null { return this.ni.get(id) ?? null; }
    getChildIds(p: string): string[] { return this.ci.get(p) ?? []; }
    getParentId(n: string): string | null { return this.pi.get(n) ?? null; }
    getRootId(): string | null { return this.rid; }
    getAllNodes(): Record<string, NodeData> {
        const r: Record<string, NodeData> = {};
        for (const [k, v] of this.ni) r[k] = v;
        return r;
    }
    get denicekInstance(): Denicek { return this.dk; }

    // ── Mutations ────────────────────────────────────────────────
    createRootNode(tag: string): string {
        const id = crypto.randomUUID();
        this.dk.add("", "root", { $tag: tag, $id: id, $kind: "element" } as unknown as PlainNode);
        this.mut(); return id;
    }

    addChildren(parentId: string, children: NodeInput[], _si?: number): string[] {
        const pp = this.rp(parentId);
        const ids: string[] = [];
        for (const c of children) {
            const id = crypto.randomUUID();
            this.dk.add(pp, id, this.mkRec(c, id) as unknown as PlainNode);
            ids.push(id);
        }
        this.mut(); return ids;
    }

    deleteNodes(nodeIds: string[]): void {
        for (const id of nodeIds) {
            const pid = this.pi.get(id);
            if (pid == null) continue;
            const pp = this.sp.get(pid);
            if (pp == null) continue;
            this.dk.delete(pp, id);
        }
        this.mut();
    }

    moveNodes(nodeIds: string[], newPid: string, _idx?: number): void {
        const np = this.rp(newPid);
        for (const id of nodeIds) {
            const pid = this.pi.get(id);
            if (pid == null) continue;
            const pp = this.sp.get(pid);
            if (pp == null) continue;
            const sub = this.dk.get(pp + "/" + id);
            if (sub.length === 0) continue;
            this.dk.delete(pp, id);
            this.dk.add(np, id, sub[0] as PlainNode);
        }
        this.mut();
    }

    updateAttribute(nodeIds: string[], key: string, value: unknown | undefined): void {
        for (const id of nodeIds) {
            const p = this.rp(id);
            if (value === undefined || value === null) {
                this.dk.delete(p, key);
            } else {
                const pv = typeof value === "object" ? JSON.stringify(value) :
                    value as string | number | boolean;
                const e = this.dk.get(p + "/" + key);
                if (e.length > 0) this.dk.set(p + "/" + key, pv);
                else this.dk.add(p, key, pv);
            }
        }
        this.mut();
    }

    updateTag(nodeIds: string[], tag: string): void {
        for (const id of nodeIds) this.dk.updateTag(this.rp(id), tag);
        this.mut();
    }

    spliceValue(nodeIds: string[], idx: number, del: number, ins: string): void {
        for (const id of nodeIds) {
            const n = this.ni.get(id);
            if (!n || n.kind !== "value") continue;
            const cur = String(n.value);
            this.dk.set(this.rp(id) + "/value", cur.slice(0, idx) + ins + cur.slice(idx + del));
        }
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
        return this.addChildren(parentId, [this.nd2input(n)], opts?.index)[0]!;
    }
    appendActions(_id: string, _a: GeneralizedPatch[]): void {}
    deleteAction(_id: string, _i: number): void {}
    moveAction(_id: string, _f: number, _t: number): void {}
    commit(_o?: string): void {}

    // ── Undo/Redo ────────────────────────────────────────────────
    undo(): boolean { if (!this.dk.canUndo) return false; this.dk.undo(); this.mut(); return true; }
    redo(): boolean { if (!this.dk.canRedo) return false; this.dk.redo(); this.mut(); return true; }
    get canUndo(): boolean { return this.dk.canUndo; }
    get canRedo(): boolean { return this.dk.canRedo; }
    clearUndoHistory(): void {}

    get currentVersion(): number { return this._v; }
    subscribe(l: () => void): () => void { this.lsnrs.add(l); return () => this.lsnrs.delete(l); }

    // ── Sync (stubbed) ───────────────────────────────────────────
    async connectToSync(_o: SyncOptions): Promise<void> { this.ssSet("disconnected", "Sync migration in progress"); }
    async disconnectSync(): Promise<void> { this.ssSet("idle"); }
    get isSyncConnected(): boolean { return this._ss === "connected"; }
    get syncRoomId(): string | null { return null; }
    getSyncState(): SyncState { return { status: this._ss, latency: undefined, roomId: null, error: this._se }; }
    onSyncStateChange(l: (s: SyncState) => void): () => void {
        this.ssl.add(l); l(this.getSyncState()); return () => this.ssl.delete(l);
    }

    // ── Peer (stubbed) ───────────────────────────────────────────
    getPeerId(): string { return this.dk.peer; }
    setPeerName(_n: string): void {}
    getPeerNames(): Record<string, string> { return {}; }
    onPeerNamesChange(l: (n: Record<string, string>) => void): () => void { l({}); return () => {}; }

    // ── History (stubbed) ────────────────────────────────────────
    getHistory(): GeneralizedPatch[] { return []; }
    getGroupedHistory(): GroupedPatch[] { return []; }
    clearHistory(): void {}
    replay(_s: GeneralizedPatch[], _p: Record<string, string>): void {}

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

    export(_m: "update" | "snapshot", _f?: Version): Uint8Array { return new Uint8Array(); }
    import(_b: Uint8Array): void {}
    getVersion(): Version { return []; }
    toJSON(): object { return this.getAllNodes(); }
    dispose(): void {}

    // ── Private: index ───────────────────────────────────────────
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
        this.sp.set(id, sel);
        this.pi.set(id, parentId);
        if (parentId === null) this.rid = id;
        switch (kind) {
            case "element": this.idxElem(rec, id, sel); break;
            case "value":
                this.ni.set(id, { id, kind: "value", value: rec["value"] as string | number }); break;
            case "action": {
                let actions: GeneralizedPatch[] = [];
                try { actions = JSON.parse(String(rec["actions"] || "[]")); } catch { /* */ }
                let params: Record<string, string> = {};
                try { params = JSON.parse(String(rec["params"] || "{}")); } catch { /* */ }
                this.ni.set(id, { id, kind: "action", label: rec["label"] as string, actions, params });
                break;
            }
            case "ref":
                this.ni.set(id, { id, kind: "ref", target: rec["target"] as string }); break;
            case "formula":
                this.ni.set(id, { id, kind: "formula", operation: rec["operation"] as string }); break;
        }
    }

    private idxElem(rec: PlainRecord, id: string, sel: string): void {
        const attrs: Record<string, unknown> = {};
        const kids: string[] = [];
        for (const key of Object.keys(rec)) {
            if (META.has(key)) continue;
            const v = rec[key];
            if (v !== undefined && isRec(v)) {
                kids.push(key);
                this.idxRec(v, sel + "/" + key, id);
            } else if (v !== undefined) {
                attrs[key] = v;
            }
        }
        this.ni.set(id, { id, kind: "element", tag: String(rec["$tag"]), attrs });
        this.ci.set(id, kids);
    }

    // ── Private: mutation helpers ─────────────────────────────────
    private mkRec(input: NodeInput, id: string): Record<string, unknown> {
        switch (input.kind) {
            case "element": {
                const r: Record<string, unknown> = { $tag: input.tag, $id: id, $kind: "element" };
                if (input.attrs) for (const [k, v] of Object.entries(input.attrs))
                    r[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
                if (input.children?.length) for (const c of input.children) {
                    const cid = crypto.randomUUID();
                    r[cid] = this.mkRec(c, cid);
                }
                return r;
            }
            case "value": return { $tag: "$value", $id: id, $kind: "value", value: input.value };
            case "action": return {
                $tag: "$action", $id: id, $kind: "action", label: input.label,
                actions: JSON.stringify(input.actions), params: JSON.stringify(input.params ?? {}),
            };
            case "ref": return { $tag: "$ref", $id: id, $kind: "ref", target: input.target };
            case "formula": return { $tag: "$formula", $id: id, $kind: "formula", operation: input.operation };
        }
    }

    private rp(id: string): string {
        const p = this.sp.get(id); if (!p) throw new Error(`Node not found: ${id}`); return p;
    }
    private mut(): void {
        this._v++; this.rebuild(); this.onVC?.(this._v);
        for (const l of this.lsnrs) l();
    }
    private nd2input(n: NodeData): NodeInput {
        switch (n.kind) {
            case "element": return { kind: "element", tag: n.tag, attrs: { ...n.attrs } };
            case "value": return { kind: "value", value: String(n.value) };
            case "action": return { kind: "action", label: n.label, actions: n.actions, params: n.params };
            case "ref": return { kind: "ref", target: n.target };
            case "formula": return { kind: "formula", operation: n.operation };
        }
    }
    private ssSet(s: SyncStatus, e?: string): void {
        this._ss = s; this._se = e ?? null;
        const st = this.getSyncState();
        for (const l of this.ssl) l(st);
    }
}
