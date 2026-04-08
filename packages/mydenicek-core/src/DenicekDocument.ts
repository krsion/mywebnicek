/**
 * DenicekDocument - Document abstraction backed by the Denicek CRDT engine.
 * Wraps the DocumentAdapter to present an ID-based tree API for the React UI.
 */

import { DocumentAdapter } from "@jsr/mydenicek__core";
import type {
    NodeData as CoreNodeData,
    NodeInput as CoreNodeInput,
} from "@jsr/mydenicek__core";

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

/** Input shape for creating nodes — uses GeneralizedPatch[] for actions. */
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

// ── DenicekDocument ──────────────────────────────────────────────────

export class DenicekDocument {
    private adapter: DocumentAdapter;
    private onVersionChangeCb?: (version: number) => void;
    private _syncStatus: SyncStatus = "idle";
    private _syncError: string | null = null;
    private syncStatusListeners = new Set<(state: SyncState) => void>();

    constructor(options?: DenicekDocumentOptions) {
        const peer = options?.peerId ?? crypto.randomUUID();
        this.onVersionChangeCb = options?.onVersionChange;
        this.adapter = new DocumentAdapter(peer);
        this.adapter.subscribe(() => {
            this.onVersionChangeCb?.(this.adapter.currentVersion);
        });
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

    getNode(id: string): NodeData | null {
        const node = this.adapter.getNode(id);
        if (!node) return null;
        return this.convertNodeData(node);
    }

    getChildIds(parentId: string): string[] {
        return this.adapter.getChildIds(parentId);
    }

    getParentId(nodeId: string): string | null {
        return this.adapter.getParentId(nodeId);
    }

    getRootId(): string | null {
        return this.adapter.getRootId();
    }

    getAllNodes(): Record<string, NodeData> {
        const raw = this.adapter.getAllNodes();
        const result: Record<string, NodeData> = {};
        for (const [id, node] of Object.entries(raw)) {
            result[id] = this.convertNodeData(node);
        }
        return result;
    }

    /** Expose the underlying Denicek for direct selector-based operations. */
    get denicekInstance() { return this.adapter.denicekInstance; }

    // ── Mutations ────────────────────────────────────────────────

    createRootNode(tag: string): string {
        return this.adapter.createRootNode(tag);
    }

    addChildren(parentId: string, children: NodeInput[], startIndex?: number): string[] {
        const coreInputs = children.map(c => this.convertNodeInput(c));
        return this.adapter.addChildren(parentId, coreInputs, startIndex);
    }

    deleteNodes(nodeIds: string[]): void {
        this.adapter.deleteNodes(nodeIds);
    }

    moveNodes(nodeIds: string[], newParentId: string, index?: number): void {
        this.adapter.moveNodes(nodeIds, newParentId, index);
    }

    updateAttribute(nodeIds: string[], key: string, value: unknown | undefined): void {
        // Denicek records only accept primitive attribute values.
        // Serialize non-primitive values to JSON strings.
        let primitiveValue: string | number | boolean | undefined;
        if (value === undefined || value === null) {
            primitiveValue = undefined;
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            primitiveValue = value;
        } else {
            primitiveValue = JSON.stringify(value);
        }
        this.adapter.updateAttribute(nodeIds, key, primitiveValue);
    }

    updateTag(nodeIds: string[], newTag: string): void {
        // Work around DocumentAdapter bug: it calls denicek.set(path+"/$tag")
        // but $tag is not a settable child node. Use denicek.updateTag() directly.
        const dk = this.adapter.denicekInstance;
        const pathIndex = (this.adapter as any).pathIndex as Map<string, string>;
        for (const id of nodeIds) {
            const path = pathIndex.get(id);
            if (path) dk.updateTag(path, newTag);
        }
        (this.adapter as any).notifyAfterMutation();
    }

    spliceValue(nodeIds: string[], index: number, deleteCount: number, insertText: string): void {
        for (const id of nodeIds) {
            const node = this.adapter.getNode(id);
            if (!node || node.kind !== "value") continue;
            const current = String(node.value);
            const spliced = current.slice(0, index) + insertText + current.slice(index + deleteCount);
            this.adapter.updateValue([id], current, spliced);
        }
    }

    updateValue(nodeIds: string[], oldValue: string, newValue: string): void {
        this.adapter.updateValue(nodeIds, oldValue, newValue);
    }

    updateFormulaOperation(id: string, operation: string): void {
        this.adapter.updateFormulaOperation(id, operation);
    }

    updateRefTarget(id: string, target: string): void {
        this.adapter.updateRefTarget(id, target);
    }

    updateNodeProperty(id: string, property: string, value: unknown): void {
        const node = this.adapter.getNode(id);
        if (!node) return;

        if (node.kind === "formula" && property === "operation") {
            this.adapter.updateFormulaOperation(id, value as string);
        } else if (node.kind === "ref" && (property === "refTarget" || property === "target")) {
            this.adapter.updateRefTarget(id, value as string);
        } else if (node.kind === "element" && property === "tag") {
            this.adapter.updateTag([id], value as string);
        } else {
            this.adapter.updateAttribute([id], property, value);
        }
    }

    copyNode(sourceId: string, parentId: string, options?: { index?: number }): string {
        const node = this.adapter.getNode(sourceId);
        if (!node) throw new Error(`Node not found: ${sourceId}`);
        const input = this.coreNodeDataToInput(node);
        const ids = this.adapter.addChildren(parentId, [input], options?.index);
        return ids[0]!;
    }

    appendActions(_id: string, _actions: GeneralizedPatch[]): void { /* Stubbed */ }
    deleteAction(_id: string, _index: number): void { /* Stubbed */ }
    moveAction(_id: string, _fromIndex: number, _toIndex: number): void { /* Stubbed */ }
    commit(_origin?: string): void { /* No-op: Denicek auto-commits */ }

    // ── Undo/Redo ────────────────────────────────────────────────

    undo(): boolean { return this.adapter.undo(); }
    redo(): boolean { return this.adapter.redo(); }
    get canUndo(): boolean { return this.adapter.canUndo; }
    get canRedo(): boolean { return this.adapter.canRedo; }
    clearUndoHistory(): void { /* No-op for now */ }

    // ── Version & Subscribe ──────────────────────────────────────

    get currentVersion(): number { return this.adapter.currentVersion; }

    subscribe(listener: () => void): () => void {
        return this.adapter.subscribe(listener);
    }

    // ── Sync (stubbed) ───────────────────────────────────────────

    async connectToSync(_options: SyncOptions): Promise<void> {
        this.setSyncStatus("disconnected", "Sync not yet implemented with new core");
    }

    async disconnectSync(): Promise<void> {
        this.setSyncStatus("idle");
    }

    get isSyncConnected(): boolean { return this._syncStatus === "connected"; }
    get syncRoomId(): string | null { return null; }

    getSyncState(): SyncState {
        return { status: this._syncStatus, latency: undefined, roomId: null, error: this._syncError };
    }

    onSyncStateChange(listener: (state: SyncState) => void): () => void {
        this.syncStatusListeners.add(listener);
        listener(this.getSyncState());
        return () => { this.syncStatusListeners.delete(listener); };
    }

    // ── Peer (stubbed) ───────────────────────────────────────────

    getPeerId(): string { return this.adapter.denicekInstance.peer; }
    setPeerName(_name: string): void { /* Stubbed */ }
    getPeerNames(): Record<string, string> { return {}; }
    onPeerNamesChange(listener: (names: Record<string, string>) => void): () => void {
        listener({});
        return () => {};
    }

    // ── History (stubbed) ────────────────────────────────────────

    getHistory(): GeneralizedPatch[] { return []; }
    getGroupedHistory(): GroupedPatch[] { return []; }
    clearHistory(): void { /* No-op */ }
    replay(_script: GeneralizedPatch[], _params: Record<string, string>): void { /* Stubbed */ }

    // ── Snapshot ─────────────────────────────────────────────────

    getSnapshot(): Snapshot {
        const nodes = new Map<string, NodeData>();
        const parents = new Map<string, string | null>();
        const childIds = new Map<string, readonly string[]>();
        for (const [id, node] of Object.entries(this.adapter.getAllNodes())) {
            nodes.set(id, this.convertNodeData(node));
            parents.set(id, this.adapter.getParentId(id));
            childIds.set(id, this.adapter.getChildIds(id));
        }
        return { nodes, parents, childIds, rootId: this.adapter.getRootId() };
    }

    // ── Import/Export (stubbed) ──────────────────────────────────

    export(_mode: "update" | "snapshot", _from?: Version): Uint8Array { return new Uint8Array(); }
    import(_bytes: Uint8Array): void { /* No-op */ }
    getVersion(): Version { return []; }
    toJSON(): object { return this.getAllNodes(); }
    dispose(): void { /* No-op */ }

    // ── Private ──────────────────────────────────────────────────

    private setSyncStatus(status: SyncStatus, error?: string): void {
        this._syncStatus = status;
        this._syncError = error ?? null;
        const state = this.getSyncState();
        for (const listener of this.syncStatusListeners) {
            listener(state);
        }
    }

    /**
     * Convert JSR CoreNodeData → local NodeData.
     * ActionNodeData shapes differ: JSR stores actions as a JSON string
     * and has target/replayMode; local stores actions as GeneralizedPatch[]
     * and params as Record<string, string>.
     */
    private convertNodeData(node: CoreNodeData): NodeData {
        if (node.kind === "action") {
            let actions: GeneralizedPatch[] = [];
            try {
                actions = JSON.parse(node.actions || "[]") as GeneralizedPatch[];
            } catch {
                actions = [];
            }
            let params: Record<string, string> = {};
            try {
                // target field doubles as serialised params JSON in our adapter
                params = node.target ? JSON.parse(node.target) as Record<string, string> : {};
            } catch {
                params = node.target ? { target: node.target } : {};
            }
            return { id: node.id, kind: "action", label: node.label, actions, params };
        }
        return node as NodeData;
    }

    /** Convert local NodeInput → JSR CoreNodeInput. */
    private convertNodeInput(input: NodeInput): CoreNodeInput {
        if (input.kind === "action") {
            return {
                kind: "action",
                label: input.label,
                actions: JSON.stringify(input.actions),
                target: JSON.stringify(input.params ?? {}),
            };
        }
        if (input.kind === "element") {
            return {
                kind: "element",
                tag: input.tag,
                attrs: input.attrs,
                children: input.children?.map(c => this.convertNodeInput(c)),
            };
        }
        return input as CoreNodeInput;
    }

    /** Convert JSR CoreNodeData → CoreNodeInput for copy operations. */
    private coreNodeDataToInput(node: CoreNodeData): CoreNodeInput {
        switch (node.kind) {
            case "element": return { kind: "element", tag: node.tag, attrs: { ...node.attrs } };
            case "value": return { kind: "value", value: String(node.value) };
            case "action": return {
                kind: "action", label: node.label, actions: node.actions,
                target: node.target, ...(node.replayMode && { replayMode: node.replayMode }),
            };
            case "ref": return { kind: "ref", target: node.target };
            case "formula": return { kind: "formula", operation: node.operation };
        }
    }
}
