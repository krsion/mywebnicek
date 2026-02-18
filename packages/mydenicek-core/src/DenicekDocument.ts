/**
 * DenicekDocument - Main document abstraction for mydenicek-core
 * This class wraps the Loro document and provides a public API
 * Includes undo/redo, history tracking, sync, and replay functionality
 */

import type { CrdtDocAdaptor } from "loro-adaptors";
import type { ContainerID, Delta, Diff, TreeDiffItem } from "loro-crdt";
import { type Frontiers, LoroDoc, LoroList, LoroMap, LoroText, LoroTree, UndoManager } from "loro-crdt";
import type { LoroWebsocketClient, LoroWebsocketClientRoom } from "loro-websocket/client";

import { handleModelError } from "./errors.js";
import {
    buildDocumentIndex,
    type DocumentIndex,
    NODE_ACTIONS,
    NODE_ATTRS,
    NODE_KIND,
    NODE_LABEL,
    NODE_OPERATION,
    NODE_PARAMS,
    NODE_REF_TARGET,
    NODE_SOURCE_ID,
    NODE_TAG,
    NODE_TEXT,
    stringToTreeId,
    TREE_CONTAINER,
    treeIdToString,
} from "./loroHelpers.js";
import type { ElementNode, GeneralizedPatch, GroupedPatch, NodeData, PatchNodeData, Snapshot, SyncState, SyncStatus, Version } from "./types.js";

/** Input type for creating nodes - string values converted to LoroText internally */
export type NodeInput =
    | ElementNode
    | { kind: "value"; value: string }
    | { kind: "action"; label: string; actions: GeneralizedPatch[]; params: Record<string, string> }
    | { kind: "formula"; operation: string }
    | { kind: "ref"; target: string };

/**
 * Sanitize and validate a tag name for use with HTML elements.
 * Returns the sanitized tag name or null if invalid.
 */
function sanitizeTagName(input: string): string | null {
    // Strip angle brackets and whitespace, convert to lowercase
    const tag = input.replace(/[<>]/g, "").trim().toLowerCase();

    if (!tag) {
        return null;
    }

    // HTML tag names must start with a letter and contain only letters, digits, or hyphens
    const validTagPattern = /^[a-z][a-z0-9-]*$/;
    if (!validTagPattern.test(tag)) {
        return null;
    }

    return tag;
}

/**
 * Options for connecting to a sync server
 */
export interface SyncOptions {
    /** WebSocket server URL */
    url: string;
    /** Room ID to join */
    roomId: string;
    /** Ping interval in ms (optional) */
    pingIntervalMs?: number;
}

/**
 * Options for creating a DenicekDocument
 */
export interface DenicekDocumentOptions {
    /** Peer ID for CRDT operations (optional, generated if not provided) */
    peerId?: bigint;
    /** Callback for local updates (useful for sync) */
    onLocalUpdate?: (bytes: Uint8Array) => void;
    /** Callback when the document version changes */
    onVersionChange?: (version: number) => void;
    /** Maximum number of undo steps (default: 100) */
    maxUndoSteps?: number;
    /** Merge interval in ms for grouping changes (default: 1000) */
    mergeInterval?: number;
}

/**
 * DenicekDocument - Main document class
 *
 * This class provides:
 * - Document state access (snapshot, nodes)
 * - Mutation API (addChild, updateAttribute, etc.) - each auto-commits
 * - Undo/redo functionality
 * - Export/import for sync
 * - Event subscriptions
 * - History tracking and replay
 */
export class DenicekDocument {
    private _doc: LoroDoc;
    private localUpdateUnsubscribe?: () => void;

    // Undo/redo
    private undoManager: UndoManager;

    // Version tracking
    private _version: number = 0;
    private onVersionChange?: (version: number) => void;

    // Accumulated per-event diffs for history tracking
    private recordedDiffs: [ContainerID, Diff][][] = [];

    // Sync state
    private syncClient: LoroWebsocketClient | null = null;
    private syncRoom: LoroWebsocketClientRoom | null = null;
    private _syncRoomId: string | null = null;
    private _syncEnabled: boolean = false; // Flag to control sync - must be true to send/receive

    // Sync status tracking
    private syncStatusListeners: Set<(state: SyncState) => void> = new Set();
    private _syncStatus: SyncStatus = "idle";
    private _syncLatency: number | undefined = undefined;
    private _syncError: string | null = null;
    private statusUnsubscribe?: () => void;
    private latencyUnsubscribe?: () => void;

    // Cached index for O(1) lookups
    private _cachedIndex: DocumentIndex | null = null;

    /** Get the Loro tree container */
    private get tree(): LoroTree {
        return this._doc.getTree(TREE_CONTAINER);
    }

    constructor(options?: DenicekDocumentOptions) {
        this._doc = new LoroDoc();
        if (options?.peerId !== undefined) {
            this._doc.setPeerId(options.peerId);
        }

        if (options?.onLocalUpdate) {
            this.localUpdateUnsubscribe = this._doc.subscribeLocalUpdates(options.onLocalUpdate);
        }

        this.onVersionChange = options?.onVersionChange;

        // Create Loro's UndoManager
        this.undoManager = new UndoManager(this._doc, {
            maxUndoSteps: options?.maxUndoSteps ?? 100,
            mergeInterval: options?.mergeInterval ?? 1000,
        });

        // Subscribe to document changes to track version, invalidate cache, and accumulate history diffs
        this._doc.subscribe((event) => {
            this._cachedIndex = null;
            this._version++;
            this.onVersionChange?.(this._version);

            // Accumulate per-event diffs for history (local changes only)
            if (event.by === "local" && event.events.length > 0) {
                this.recordedDiffs.push(
                    event.events.map(e => [e.target, e.diff] as [ContainerID, Diff]),
                );
            }
        });
    }

    /**
     * Get the cached index, building it if necessary
     */
    private getIndex(): DocumentIndex {
        if (!this._cachedIndex) {
            this._cachedIndex = buildDocumentIndex(this._doc);
        }
        return this._cachedIndex;
    }

    // === Sync ===

    /**
     * Connect to a sync server and join a room
     * @param options Sync connection options
     * @returns Promise that resolves when connected and initial sync is complete
     */
    async connectToSync(options: SyncOptions): Promise<void> {
        // Disconnect existing connection if any
        await this.disconnectSync();

        this._syncEnabled = true;
        this.setSyncStatus("connecting");

        try {
            // Dynamic import to keep sync dependencies optional
            const { LoroWebsocketClient } = await import("loro-websocket/client");
            const { LoroAdaptor } = await import("loro-adaptors/loro");

            const client = new LoroWebsocketClient({
                url: options.url,
                pingIntervalMs: options.pingIntervalMs,
            });

            // Subscribe to status changes BEFORE connecting
            this.statusUnsubscribe = client.onStatusChange((status) => {
                // Only update status if sync is still enabled
                if (this._syncEnabled) {
                    this.setSyncStatus(status);
                }
            });

            this.latencyUnsubscribe = client.onLatency((ms) => {
                if (this._syncEnabled) {
                    this._syncLatency = ms;
                    this.notifySyncStateChange();
                }
            });

            await client.connect();

            // Create a wrapper adaptor that checks _syncEnabled before sending
            const innerAdaptor = new LoroAdaptor(this._doc);
            const wrappedAdaptor = this.createSyncControlledAdaptor(innerAdaptor);

            const room = await client.join({
                roomId: options.roomId,
                crdtAdaptor: wrappedAdaptor,
            });

            await room.waitForReachingServerVersion();

            this.commit("sync-connect");

            this.syncClient = client;
            this.syncRoom = room;
            this._syncRoomId = options.roomId;
            // Status is already "connected" via onStatusChange callback
        } catch (error) {
            this._syncEnabled = false;
            const errorMessage = error instanceof Error ? error.message : "Connection failed";
            this.setSyncStatus("disconnected", errorMessage);
            throw error;
        }
    }

    /**
     * Creates a wrapper adaptor that only sends updates when _syncEnabled is true
     */
    private createSyncControlledAdaptor(innerAdaptor: CrdtDocAdaptor): CrdtDocAdaptor {
        const isSyncEnabled = () => this._syncEnabled;
        return {
            crdtType: innerAdaptor.crdtType,
            setCtx: (ctx) => {
                // Wrap the send function to check _syncEnabled
                const wrappedCtx = {
                    ...ctx,
                    send: (updates: Uint8Array[]) => {
                        if (isSyncEnabled()) {
                            ctx.send(updates);
                        }
                    }
                };
                innerAdaptor.setCtx(wrappedCtx);
            },
            handleJoinOk: (res) => innerAdaptor.handleJoinOk(res),
            waitForReachingServerVersion: () => innerAdaptor.waitForReachingServerVersion(),
            applyUpdate: (updates: Uint8Array[]) => {
                // Only apply incoming updates if sync is enabled
                if (isSyncEnabled()) {
                    innerAdaptor.applyUpdate(updates);
                }
            },
            cmpVersion: (v: Uint8Array) => innerAdaptor.cmpVersion(v),
            getVersion: () => innerAdaptor.getVersion(),
            getAlternativeVersion: innerAdaptor.getAlternativeVersion?.bind(innerAdaptor),
            onUpdateError: innerAdaptor.onUpdateError?.bind(innerAdaptor),
            destroy: () => innerAdaptor.destroy(),
        };
    }

    /**
     * Disconnect from the sync server
     */
    async disconnectSync(): Promise<void> {
        // Disable sync first to stop any pending sends
        this._syncEnabled = false;

        // Cleanup status subscriptions
        this.statusUnsubscribe?.();
        this.latencyUnsubscribe?.();
        this.statusUnsubscribe = undefined;
        this.latencyUnsubscribe = undefined;

        // Destroy room (cleans up adaptor)
        if (this.syncRoom) {
            await this.syncRoom.destroy().catch(() => {});
            this.syncRoom = null;
        }
        // Close client (stops auto-reconnect)
        if (this.syncClient) {
            this.syncClient.close();
            this.syncClient = null;
        }
        this._syncRoomId = null;
        this._syncLatency = undefined;
        this.setSyncStatus("idle");
    }

    /**
     * Check if sync is active (connected and enabled)
     */
    get isSyncConnected(): boolean {
        return this._syncEnabled && this.syncClient !== null && this.syncRoom !== null;
    }

    /**
     * Get the current room ID if connected
     */
    get syncRoomId(): string | null {
        return this._syncRoomId;
    }

    /**
     * Get the current sync state
     */
    getSyncState(): SyncState {
        return {
            status: this._syncStatus,
            latency: this._syncLatency,
            roomId: this._syncRoomId,
            error: this._syncError,
        };
    }

    /**
     * Subscribe to sync state changes
     * @returns Unsubscribe function
     */
    onSyncStateChange(listener: (state: SyncState) => void): () => void {
        this.syncStatusListeners.add(listener);
        // Immediately notify with current state
        listener(this.getSyncState());
        return () => {
            this.syncStatusListeners.delete(listener);
        };
    }

    private notifySyncStateChange(): void {
        const state = this.getSyncState();
        for (const listener of this.syncStatusListeners) {
            listener(state);
        }
    }

    private setSyncStatus(status: SyncStatus, error?: string): void {
        this._syncStatus = status;
        this._syncError = error ?? null;
        this.notifySyncStateChange();
    }

    // === Peer Names ===

    private static PEER_NAMES_CONTAINER = "peerNames";

    /**
     * Get the peer ID as a string
     */
    getPeerId(): string {
        return this._doc.peerIdStr;
    }

    /**
     * Set the name for the current peer
     */
    setPeerName(name: string): void {
        const map = this._doc.getMap(DenicekDocument.PEER_NAMES_CONTAINER);
        map.set(this._doc.peerIdStr, name);
        this._doc.commit();
    }

    /**
     * Get all peer names as a record
     */
    getPeerNames(): Record<string, string> {
        const map = this._doc.getMap(DenicekDocument.PEER_NAMES_CONTAINER);
        return map.toJSON() as Record<string, string>;
    }

    /**
     * Subscribe to peer names changes
     * Uses document-level subscription to catch sync/import changes
     * @returns Unsubscribe function
     */
    onPeerNamesChange(listener: (names: Record<string, string>) => void): () => void {
        // Use document-level subscription to catch all changes including sync imports
        let lastNames = JSON.stringify(this.getPeerNames());
        return this._doc.subscribe(() => {
            const currentNames = JSON.stringify(this.getPeerNames());
            if (currentNames !== lastNames) {
                lastNames = currentNames;
                listener(this.getPeerNames());
            }
        });
    }

    // === Version ===

    /**
     * Get the current version number (increments on each change)
     */
    get currentVersion(): number {
        return this._version;
    }

    // === Node Access ===

    /**
     * Get node data by ID. Returns null if node doesn't exist.
     */
    getNode(id: string): NodeData | null {
        return this.getIndex().nodes.get(id) ?? null;
    }

    /**
     * Get the IDs of all children of a node.
     * Returns empty array if node doesn't exist or is a value node.
     */
    getChildIds(parentId: string): string[] {
        return this.getIndex().childIds.get(parentId) ?? [];
    }

    /**
     * Get the parent ID of a node.
     * Returns null if node is root or doesn't exist.
     */
    getParentId(nodeId: string): string | null {
        return this.getIndex().parents.get(nodeId) ?? null;
    }

    /**
     * Get the root node ID
     */
    getRootId(): string | null {
        return this.getIndex().rootId;
    }

    /**
     * Get all nodes as a record
     */
    getAllNodes(): Record<string, NodeData> {
        const index = this.getIndex();
        const result: Record<string, NodeData> = {};
        for (const [id, node] of index.nodes) {
            result[id] = node;
        }
        return result;
    }

    // === Snapshot ===

    /**
     * Get an immutable snapshot of the current document state.
     * Use for temporal comparisons (e.g., diff views).
     * For live access, use getNode/getChildIds/getParentId directly.
     */
    getSnapshot(): Snapshot {
        const index = this.getIndex();
        return {
            nodes: new Map(index.nodes),
            parents: new Map(index.parents),
            childIds: new Map(index.childIds.entries()),
            rootId: index.rootId,
        };
    }

    /**
     * Convert the document to a JSON representation
     */
    toJSON(): object {
        const index = this.getIndex();
        const result: Record<string, unknown> = {};
        for (const [id, node] of index.nodes) {
            result[id] = node;
        }
        return { root: index.rootId, nodes: result };
    }

    // === Mutations ===

    /**
     * Create a root element node (no parent)
     * @returns The ID of the created root node
     */
    createRootNode(tag: string): string {
        try {
            const sanitizedTag = sanitizeTagName(tag);
            if (!sanitizedTag) {
                handleModelError("createRootNode", new Error(`Invalid tag name: "${tag}"`));
                return "";
            }

            const rootNode = this.tree.createNode();
            const data = rootNode.data;
            data.set(NODE_KIND, "element");
            data.set(NODE_TAG, sanitizedTag);
            data.setContainer(NODE_ATTRS, new LoroMap());
            this._doc.commit();
            return treeIdToString(rootNode.id);
        } catch (e) {
            handleModelError("createRootNode", e);
            return "";
        }
    }

    /**
     * Add children to a parent node
     * @returns The IDs of the created nodes
     */
    addChildren(parentId: string, children: NodeInput[], startIndex?: number): string[] {
        try {
            const parentTreeId = stringToTreeId(parentId);
            const parentNode = this.tree.getNodeByID(parentTreeId);
            if (!parentNode) return [];

            const newIds: string[] = [];

            for (let i = 0; i < children.length; i++) {
                const child = children[i]!;
                let sanitizedChild = child;
                if (child.kind === "element") {
                    const sanitizedTag = sanitizeTagName(child.tag);
                    if (!sanitizedTag) {
                        handleModelError("addChildren", new Error(`Invalid tag name: "${child.tag}"`));
                        continue;
                    }
                    sanitizedChild = { ...child, tag: sanitizedTag };
                }

                const index = startIndex !== undefined ? startIndex + i : undefined;
                const newNode = parentNode.createNode(index);
                const data = newNode.data;

                if (sanitizedChild.kind === "element") {
                    data.set(NODE_KIND, "element");
                    data.set(NODE_TAG, sanitizedChild.tag);
                    const attrsMap = data.setContainer(NODE_ATTRS, new LoroMap()) as LoroMap;
                    for (const [key, value] of Object.entries(sanitizedChild.attrs)) {
                        attrsMap.set(key, value);
                    }
                } else if (sanitizedChild.kind === "action") {
                    data.set(NODE_KIND, "action");
                    data.set(NODE_LABEL, sanitizedChild.label);
                    data.set(NODE_PARAMS, sanitizedChild.params);
                    const actionsList = data.setContainer(NODE_ACTIONS, new LoroList()) as LoroList;
                    for (const action of sanitizedChild.actions) {
                        actionsList.push(action);
                    }
                } else if (sanitizedChild.kind === "formula") {
                    data.set(NODE_KIND, "formula");
                    data.set(NODE_OPERATION, sanitizedChild.operation);
                } else if (sanitizedChild.kind === "ref") {
                    data.set(NODE_KIND, "ref");
                    data.set(NODE_REF_TARGET, sanitizedChild.target);
                } else {
                    data.set(NODE_KIND, "value");
                    const textContainer = data.setContainer(NODE_TEXT, new LoroText()) as LoroText;
                    textContainer.insert(0, sanitizedChild.value);
                }

                const newId = treeIdToString(newNode.id);
                newIds.push(newId);
            }

            this._doc.commit();
            return newIds;
        } catch (e) {
            handleModelError("addChildren", e);
            return [];
        }
    }

    /**
     * Delete nodes from the document
     */
    deleteNodes(nodeIds: string[]): void {
        try {
            for (const id of nodeIds) {
                const treeId = stringToTreeId(id);
                this.tree.delete(treeId);
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("deleteNode", e);
        }
    }

    /**
     * Move nodes to a new parent
     */
    moveNodes(nodeIds: string[], newParentId: string, index?: number): void {
        try {
            const parentTreeId = stringToTreeId(newParentId);
            const parentNode = this.tree.getNodeByID(parentTreeId);
            if (!parentNode) return;

            for (const nodeId of nodeIds) {
                const treeId = stringToTreeId(nodeId);
                const treeNode = this.tree.getNodeByID(treeId);
                if (!treeNode) continue;

                if (index !== undefined) {
                    treeNode.move(parentNode, index);
                } else {
                    treeNode.move(parentNode);
                }
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("moveNode", e);
        }
    }

    /**
     * Copy a node as a child of the specified parent
     * @returns The ID of the newly created copy
     */
    copyNode(sourceId: string, parentId: string, options?: { index?: number }): string {
        try {
            const { index } = options ?? {};

            const sourceTreeId = stringToTreeId(sourceId);
            const sourceTreeNode = this.tree.getNodeByID(sourceTreeId);
            if (!sourceTreeNode || sourceTreeNode.isDeleted?.()) {
                handleModelError("copyNode", new Error(`Source node not found: ${sourceId}`));
                return "";
            }

            const parentTreeId = stringToTreeId(parentId);
            const parentNode = this.tree.getNodeByID(parentTreeId);
            if (!parentNode) {
                handleModelError("copyNode", new Error(`Parent node not found: ${parentId}`));
                return "";
            }

            const sourceData = sourceTreeNode.data;
            const newNode = parentNode.createNode(index);
            const data = newNode.data;

            const sourceKind = sourceData.get(NODE_KIND) as "element" | "value" | "action" | "formula" | "ref" | undefined;
            if (sourceKind === "element") {
                data.set(NODE_KIND, "element");
                data.set(NODE_TAG, (sourceData.get(NODE_TAG) as string) || "div");
                const attrsMap = data.setContainer(NODE_ATTRS, new LoroMap()) as LoroMap;
                const sourceAttrs = sourceData.get(NODE_ATTRS);
                if (sourceAttrs && sourceAttrs instanceof LoroMap) {
                    for (const [key, value] of Object.entries(sourceAttrs.toJSON() as Record<string, unknown>)) {
                        attrsMap.set(key, value);
                    }
                }
            } else if (sourceKind === "action") {
                data.set(NODE_KIND, "action");
                data.set(NODE_LABEL, (sourceData.get(NODE_LABEL) as string) || "Action");
                const sourceParams = sourceData.get(NODE_PARAMS);
                data.set(NODE_PARAMS, sourceParams && typeof sourceParams === "object" ? sourceParams : {});
                const actionsList = data.setContainer(NODE_ACTIONS, new LoroList()) as LoroList;
                const sourceActions = sourceData.get(NODE_ACTIONS) as LoroList | undefined;
                if (sourceActions) {
                    for (const action of sourceActions.toJSON() as GeneralizedPatch[]) {
                        actionsList.push(action);
                    }
                }
            } else if (sourceKind === "formula") {
                data.set(NODE_KIND, "formula");
                data.set(NODE_OPERATION, (sourceData.get(NODE_OPERATION) as string) || "");
            } else if (sourceKind === "ref") {
                data.set(NODE_KIND, "ref");
                data.set(NODE_REF_TARGET, (sourceData.get(NODE_REF_TARGET) as string) || "");
            } else {
                data.set(NODE_KIND, "value");
                const textContainer = data.setContainer(NODE_TEXT, new LoroText()) as LoroText;
                const sourceText = sourceData.get(NODE_TEXT) as LoroText | undefined;
                if (sourceText) {
                    textContainer.insert(0, sourceText.toString());
                }
            }

            data.set(NODE_SOURCE_ID, sourceId);

            const newId = treeIdToString(newNode.id);

            this._doc.commit();
            return newId;
        } catch (e) {
            handleModelError("copyNode", e);
            return "";
        }
    }

    /**
     * Update an attribute on element nodes
     * Pass undefined to delete the attribute
     */
    updateAttribute(nodeIds: string[], key: string, value: unknown | undefined): void {
        try {
            for (const id of nodeIds) {
                const treeId = stringToTreeId(id);
                const treeNode = this.tree.getNodeByID(treeId);
                if (!treeNode) continue;

                const data = treeNode.data;
                const kind = data.get(NODE_KIND);
                if (kind !== "element") continue;

                let attrsMap = data.get(NODE_ATTRS) as LoroMap | undefined;
                if (!attrsMap) {
                    attrsMap = data.setContainer(NODE_ATTRS, new LoroMap()) as LoroMap;
                }

                if (value === undefined) {
                    attrsMap.delete(key);
                } else {
                    attrsMap.set(key, value);
                }
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("updateAttribute", e);
        }
    }

    /**
     * Update the tag name of element nodes
     */
    updateTag(nodeIds: string[], newTag: string): void {
        try {
            const sanitizedTag = sanitizeTagName(newTag);
            if (!sanitizedTag) {
                handleModelError("updateTag", new Error(`Invalid tag name: "${newTag}"`));
                return;
            }

            for (const id of nodeIds) {
                const treeId = stringToTreeId(id);
                const treeNode = this.tree.getNodeByID(treeId);
                if (!treeNode) continue;

                const data = treeNode.data;
                const kind = data.get(NODE_KIND);
                if (kind !== "element") continue;

                data.set(NODE_TAG, sanitizedTag);
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("updateTag", e);
        }
    }

    /**
     * Edit text in value nodes (insert, delete, or replace)
     */
    spliceValue(nodeIds: string[], index: number, deleteCount: number, insertText: string): void {
        try {
            for (const id of nodeIds) {
                const treeId = stringToTreeId(id);
                const treeNode = this.tree.getNodeByID(treeId);
                if (!treeNode) continue;

                const data = treeNode.data;
                const kind = data.get(NODE_KIND);
                if (kind !== "value") continue;

                const text = data.get(NODE_TEXT) as LoroText | undefined;
                if (!text) continue;

                text.splice(index, deleteCount, insertText);
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("spliceValue", e);
        }
    }

    /**
     * Update the text value of value nodes by computing minimal splice
     */
    updateValue(nodeIds: string[], oldValue: string, newValue: string): void {
        // Calculate minimal splice operation
        let start = 0;
        while (start < oldValue.length && start < newValue.length && oldValue[start] === newValue[start]) {
            start++;
        }

        let oldEnd = oldValue.length;
        let newEnd = newValue.length;

        while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) {
            oldEnd--;
            newEnd--;
        }

        const deleteCount = oldEnd - start;
        const insertText = newValue.slice(start, newEnd);

        this.spliceValue(nodeIds, start, deleteCount, insertText);
    }

    /**
     * Update a formula node's operation
     */
    updateFormulaOperation(id: string, operation: string): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND);
            if (kind !== "formula") return;

            data.set(NODE_OPERATION, operation);
            this._doc.commit();
        } catch (e) {
            handleModelError("updateFormulaOperation", e);
        }
    }

    /**
     * Update a ref node's target
     */
    updateRefTarget(id: string, target: string): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND);
            if (kind !== "ref") return;

            data.set(NODE_REF_TARGET, target);
            this._doc.commit();
        } catch (e) {
            handleModelError("updateRefTarget", e);
        }
    }

    /**
     * Append actions to an action node's actions list
     */
    appendActions(id: string, actions: GeneralizedPatch[]): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND);
            if (kind !== "action") return;

            const actionsList = data.get(NODE_ACTIONS) as LoroList | undefined;
            if (!actionsList) return;

            for (const action of actions) {
                actionsList.push(action);
            }
            this._doc.commit();
        } catch (e) {
            handleModelError("appendActions", e);
        }
    }

    /**
     * Delete an action from an action node's actions list
     */
    deleteAction(id: string, index: number): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND);
            if (kind !== "action") return;

            const actionsList = data.get(NODE_ACTIONS) as LoroList | undefined;
            if (!actionsList) return;

            actionsList.delete(index, 1);
            this._doc.commit();
        } catch (e) {
            handleModelError("deleteAction", e);
        }
    }

    /**
     * Move an action within an action node's actions list
     */
    moveAction(id: string, fromIndex: number, toIndex: number): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND);
            if (kind !== "action") return;

            const actionsList = data.get(NODE_ACTIONS) as LoroList | undefined;
            if (!actionsList) return;

            const item = actionsList.get(fromIndex);
            if (item === undefined) return;

            actionsList.delete(fromIndex, 1);
            const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
            actionsList.insert(adjustedToIndex, item);
            this._doc.commit();
        } catch (e) {
            handleModelError("moveAction", e);
        }
    }

    /**
     * Generic property update for any node type
     */
    updateNodeProperty(id: string, property: string, value: unknown): void {
        try {
            const treeId = stringToTreeId(id);
            const treeNode = this.tree.getNodeByID(treeId);
            if (!treeNode) return;

            const data = treeNode.data;
            const kind = data.get(NODE_KIND) as "element" | "value" | "action" | "formula" | "ref" | undefined;

            if (kind === "formula") {
                if (property === "operation") {
                    this.updateFormulaOperation(id, value as string);
                }
                return;
            }

            if (kind === "ref") {
                if (property === "refTarget" || property === "target") {
                    this.updateRefTarget(id, value as string);
                }
                return;
            }

            if (kind === "action") {
                if (property === "label") {
                    data.set(NODE_LABEL, value as string);
                    this._doc.commit();
                } else if (property === "params") {
                    data.set(NODE_PARAMS, value as Record<string, string>);
                    this._doc.commit();
                } else if (property === "actions") {
                    const actionsContainer = data.get(NODE_ACTIONS) as LoroList | undefined;
                    if (actionsContainer) {
                        const length = actionsContainer.length;
                        if (length > 0) {
                            actionsContainer.delete(0, length);
                        }
                        for (const action of value as GeneralizedPatch[]) {
                            actionsContainer.push(action);
                        }
                        this._doc.commit();
                    }
                }
            } else if (kind === "element") {
                if (property === "tag") {
                    this.updateTag([id], value as string);
                }
            }
        } catch (e) {
            handleModelError("updateNodeProperty", e);
        }
    }

    /**
     * Commit pending changes (usually not needed - mutations auto-commit)
     */
    commit(origin?: string): void {
        if (origin) {
            this._doc.commit({ origin });
        } else {
            this._doc.commit();
        }
    }

    // === Undo/Redo ===

    /**
     * Undo the last change
     */
    undo(): boolean {
        return this.undoManager.undo();
    }

    /**
     * Redo the last undone change
     */
    redo(): boolean {
        const result = this.undoManager.redo();
        this._doc.commit();
        return result;
    }

    /**
     * Check if undo is available
     */
    get canUndo(): boolean {
        return this.undoManager.canUndo();
    }

    /**
     * Clear undo/redo history (e.g., after document initialization)
     */
    clearUndoHistory(): void {
        this.undoManager.clear();
    }

    /**
     * Check if redo is available
     */
    get canRedo(): boolean {
        return this.undoManager.canRedo();
    }

    // === Sync ===

    /**
     * Export document state or updates
     * @param mode "update" for incremental updates, "snapshot" for full state
     * @param from Optional version to export updates from (only for mode="update")
     */
    export(mode: "update" | "snapshot", from?: Version): Uint8Array {
        if (mode === "snapshot") {
            return this._doc.export({ mode: "snapshot" });
        } else {
            if (from && from.length > 0) {
                const vv = this._doc.frontiersToVV(from as Frontiers);
                return this._doc.export({ mode: "update", from: vv });
            }
            return this._doc.export({ mode: "update" });
        }
    }

    /**
     * Import updates or snapshot into the document
     */
    import(bytes: Uint8Array): void {
        this._doc.import(bytes);
    }

    /**
     * Get the current document version (frontiers)
     * Use this to track sync state
     */
    getVersion(): Version {
        return this._doc.frontiers() as Version;
    }

    // === Subscriptions ===

    /**
     * Subscribe to document changes
     * The listener is called whenever the document changes (local or remote)
     * @returns Unsubscribe function
     */
    subscribe(listener: () => void): () => void {
        return this._doc.subscribe(listener);
    }

    // === Patch History (derived from Loro diff) ===

    /**
     * Get all patches since recording started, derived from Loro's native diff.
     * Patches use generalized IDs ($1, $2, etc.) for newly created nodes.
     */
    getHistory(): GeneralizedPatch[] {
        return this.diffToPatches(this.recordedDiffs);
    }

    /**
     * Get patches grouped by target node for cleaner UI display
     */
    getGroupedHistory(): GroupedPatch[] {
        const patches = this.getHistory();
        const groups = new Map<string, GeneralizedPatch[]>();

        for (const patch of patches) {
            const target = this.getPatchTarget(patch);
            if (!groups.has(target)) groups.set(target, []);
            groups.get(target)!.push(patch);
        }

        return Array.from(groups.entries()).map(([target, operations]) => ({ target, operations }));
    }

    /**
     * Clear recorded patches (resets recording start to current frontier)
     */
    clearHistory(): void {
        this.recordedDiffs = [];
    }

    private getPatchTarget(patch: GeneralizedPatch): string {
        return patch.target;
    }

    /**
     * Extract tree node ID from a Loro container ID.
     * Container IDs for tree node data follow the pattern "cid:<treeId>:Map".
     */
    private static nodeIdFromContainerId(containerId: string): string | null {
        const str = String(containerId);
        if (str.startsWith("cid:") && str.endsWith(":Map")) {
            const inner = str.slice(4, -4);
            // Tree IDs contain "@", sub-containers don't match this pattern directly
            if (inner.includes("@")) return inner;
        }
        return null;
    }

    private diffToPatches(eventDiffs: [ContainerID, Diff][][]): GeneralizedPatch[] {
        const patches: GeneralizedPatch[] = [];

        // Build container ID → node ID lookup for existing nodes
        const containerToNode = this.buildContainerIdMap();

        for (const diffs of eventDiffs) {
            // Track nodes created in this event — their map/text patches are
            // redundant because the create patch captures full state via nodeDataInEvent
            const createdInEvent = new Set<string>();
            // Collect map diff values for created nodes (survives undo since it's from the diffs)
            const nodeDataInEvent = new Map<string, Record<string, unknown>>();

            // First pass: collect tree creates and extract map data from diffs
            for (const [containerId, diff] of diffs) {
                if (diff.type === "tree") {
                    for (const item of (diff as { type: "tree"; diff: TreeDiffItem[] }).diff) {
                        if (item.action === "create") {
                            const actualId = treeIdToString(item.target);
                            createdInEvent.add(actualId);
                        }
                    }
                } else if (diff.type === "map") {
                    // Try to extract node ID from container ID (works even for deleted nodes)
                    const nodeId = DenicekDocument.nodeIdFromContainerId(String(containerId))
                        ?? containerToNode.get(String(containerId));
                    if (nodeId) {
                        const updated = (diff as { type: "map"; updated: Record<string, unknown> }).updated;
                        const existing = nodeDataInEvent.get(nodeId);
                        if (existing) {
                            Object.assign(existing, updated);
                        } else {
                            nodeDataInEvent.set(nodeId, { ...updated });
                        }
                    }
                }
            }

            // Resolve LoroText containers in map diffs to their string content
            for (const data of nodeDataInEvent.values()) {
                if (data.kind === "value" && data.text != null && typeof data.text !== "string") {
                    data.text = String(data.text);
                }
            }

            // Second pass: convert to patches, suppressing map/text for same-event creates
            for (const [containerId, diff] of diffs) {
                if (diff.type === "tree") {
                    for (const item of (diff as { type: "tree"; diff: TreeDiffItem[] }).diff) {
                        const patch = this.treeDiffToPatch(item, nodeDataInEvent);
                        if (patch) patches.push(patch);
                    }
                } else if (diff.type === "map") {
                    const nodeId = DenicekDocument.nodeIdFromContainerId(String(containerId))
                        ?? containerToNode.get(String(containerId));
                    if (nodeId && !createdInEvent.has(nodeId)) {
                        const updated = (diff as { type: "map"; updated: Record<string, unknown> }).updated;
                        for (const [key, value] of Object.entries(updated)) {
                            if (value !== undefined) {
                                patches.push({ type: "map", target: nodeId, key, value });
                            }
                        }
                    }
                } else if (diff.type === "text") {
                    const nodeId = containerToNode.get(String(containerId));
                    if (nodeId && !createdInEvent.has(nodeId)) {
                        const deltas = (diff as { type: "text"; diff: Delta<string>[] }).diff;
                        patches.push(...this.textDeltaToPatches(deltas, nodeId));
                    }
                }
            }
        }

        return patches;
    }

    private treeDiffToPatch(
        item: TreeDiffItem,
        nodeDataInEvent: Map<string, Record<string, unknown>>,
    ): GeneralizedPatch | null {
        const target = treeIdToString(item.target);

        if (item.action === "create") {
            const parent = item.parent ? treeIdToString(item.parent) : "root";

            // Build node data from same-event map diffs (survives undo) or fall back to live node
            const diffData = nodeDataInEvent.get(target);
            const sourceId = diffData?.sourceId as string | undefined
                ?? this.getNode(target)?.sourceId;

            // Copy creates: emit sourceId so replay uses copyNode
            if (sourceId) {
                return {
                    type: "tree",
                    action: "create",
                    target,
                    parent,
                    index: item.index,
                    sourceId,
                };
            }

            // Direct creates: build PatchNodeData from diff data
            const data = diffData
                ? this.diffDataToNodeData(diffData)
                : this.nodeToData(this.getNode(target));
            return {
                type: "tree",
                action: "create",
                target,
                parent,
                index: item.index,
                data,
            };
        }

        if (item.action === "delete") {
            return { type: "tree", action: "delete", target };
        }

        if (item.action === "move") {
            const parent = item.parent ? treeIdToString(item.parent) : "root";
            return { type: "tree", action: "move", target, parent, index: item.index };
        }

        return null;
    }

    /** Convert raw map diff values to PatchNodeData */
    private diffDataToNodeData(data: Record<string, unknown>): PatchNodeData {
        const kind = data.kind as string | undefined;
        if (kind === "element") {
            return { kind: "element", tag: (data.tag as string) || "div", attrs: {} };
        }
        if (kind === "value") {
            return { kind: "value", value: String(data.text ?? "") };
        }
        if (kind === "ref") {
            return { kind: "ref", target: (data.refTarget as string) ?? "" };
        }
        if (kind === "formula") {
            return { kind: "formula", operation: (data.operation as string) ?? "" };
        }
        return { kind: "element", tag: "div" };
    }

    /** Convert a NodeData to PatchNodeData for inline create patches */
    private nodeToData(node: NodeData | null): PatchNodeData {
        if (node?.kind === "element") {
            return { kind: "element", tag: node.tag, attrs: { ...node.attrs } };
        }
        if (node?.kind === "value") {
            return { kind: "value", value: String(node.value) };
        }
        if (node?.kind === "ref") {
            return { kind: "ref", target: node.target };
        }
        if (node?.kind === "formula") {
            return { kind: "formula", operation: node.operation };
        }
        // Fallback for null/unknown — create a placeholder element
        return { kind: "element", tag: "div" };
    }

    /**
     * Build a mapping from Loro container IDs to tree node IDs.
     * Each tree node has a data map (and possibly sub-containers for attrs, text, actions).
     * This walks all tree nodes and records all their container IDs.
     */
    private buildContainerIdMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const treeNode of this.tree.nodes()) {
            const nodeId = treeIdToString(treeNode.id);
            const data = treeNode.data;
            map.set(String(data.id), nodeId);

            // Map sub-containers (attrs, text, actions) to the same node
            for (const key of [NODE_ATTRS, NODE_TEXT, NODE_ACTIONS]) {
                const sub = data.get(key);
                if (sub && typeof sub === "object" && "id" in sub) {
                    map.set(String((sub as { id: string }).id), nodeId);
                }
            }
        }
        return map;
    }

    private textDeltaToPatches(deltas: Delta<string>[], target: string): GeneralizedPatch[] {
        const patches: GeneralizedPatch[] = [];
        let index = 0;

        for (const delta of deltas) {
            if ('retain' in delta && delta.retain !== undefined) {
                index += delta.retain;
            } else if ('delete' in delta && delta.delete !== undefined) {
                patches.push({
                    type: "text",
                    target,
                    index,
                    delete: delta.delete,
                    insert: ""
                });
            } else if ('insert' in delta && delta.insert !== undefined) {
                const insertText = Array.isArray(delta.insert) ? delta.insert.join("") : delta.insert;
                patches.push({
                    type: "text",
                    target,
                    index,
                    delete: 0,
                    insert: insertText
                });
                index += insertText.length;
            }
        }

        return patches;
    }

    /**
     * Replay a recorded script with named parameter bindings
     * @param script The recorded patches to replay
     * @param params Named parameters mapping param names to node IDs (e.g., { wrapper: "id1", innerValue: "id2" })
     */
    replay(script: GeneralizedPatch[], params: Record<string, string>): void {
        const vars = new Map<string, string>();
        for (const [name, nodeId] of Object.entries(params)) {
            // Add $ prefix if not already present
            const varName = name.startsWith("$") ? name : `$${name}`;
            vars.set(varName, nodeId);
        }

        // Track nodes created via copyNode — their map/text patches are redundant
        // because copyNode already captures the full current state
        const createdNodes = new Set<string>();

        for (const patch of script) {
            const concretePatch = this.degeneralizePatch(patch, vars);

            // Skip map/text patches for nodes just created in this replay.
            // copyNode copies the current state, so these patches would duplicate
            // (maps: harmless junk, text: corrupting insertion on top of existing text)
            if ((concretePatch.type === "map" || concretePatch.type === "text")
                && createdNodes.has(concretePatch.target)) {
                continue;
            }

            const result = this.applyPatchInternal(concretePatch);

            if (patch.type === "tree" && patch.action === "create") {
                if (patch.target.startsWith("$") && typeof result === "string") {
                    vars.set(patch.target, result);
                }
                if (typeof result === "string") {
                    createdNodes.add(result);
                }
            }
        }
    }

    private degeneralizePatch(patch: GeneralizedPatch, vars: Map<string, string>): GeneralizedPatch {
        const resolve = (id: string): string => {
            if (id.startsWith("$")) {
                return vars.get(id) ?? id;
            }
            return id;
        };

        if (patch.type === "tree") {
            if (patch.action === "create") {
                return {
                    ...patch,
                    target: resolve(patch.target),
                    parent: resolve(patch.parent),
                    ...(patch.sourceId && { sourceId: resolve(patch.sourceId) })
                };
            }
            if (patch.action === "delete") {
                return { ...patch, target: resolve(patch.target) };
            }
            if (patch.action === "move") {
                return {
                    ...patch,
                    target: resolve(patch.target),
                    parent: resolve(patch.parent)
                };
            }
        }

        if (patch.type === "map") {
            return {
                ...patch,
                target: resolve(patch.target),
                value: this.degeneralizeValue(patch.value, vars)
            };
        }

        if (patch.type === "text") {
            return { ...patch, target: resolve(patch.target) };
        }

        return patch;
    }

    /**
     * Apply a patch - used for replay. Uses public methods (each auto-commits,
     * but Loro's merge interval groups them for undo).
     */
    private applyPatchInternal(patch: GeneralizedPatch): unknown {
        try {
            if (patch.type === "tree") {
                if (patch.action === "create") {
                    // Inline data: create a new node from template (pre-programmed actions)
                    if (patch.data) {
                        const nodeInput = patch.data.kind === "element"
                            ? { kind: "element" as const, tag: patch.data.tag, attrs: patch.data.attrs ?? {}, children: [] }
                            : patch.data;
                        const idx = patch.index === -1 ? undefined : patch.index;
                        const [id] = this.addChildren(patch.parent, [nodeInput], idx);
                        return id;
                    }
                    // Copy from sourceId or original target (recorded history replay)
                    const copyFrom = patch.sourceId ?? patch.target;
                    return this.copyNode(copyFrom, patch.parent, { index: patch.index });
                }
                if (patch.action === "delete") {
                    this.deleteNodes([patch.target]);
                    return undefined;
                }
                if (patch.action === "move") {
                    this.moveNodes([patch.target], patch.parent, patch.index);
                    return undefined;
                }
            }

            if (patch.type === "map") {
                // Special node properties are stored directly on node data, not in attrs
                const specialKeys = new Set(["tag", "operation", "label", "params", "actions", "refTarget", "target"]);
                if (specialKeys.has(patch.key)) {
                    this.updateNodeProperty(patch.target, patch.key, patch.value);
                } else {
                    // Regular attributes (style, className, etc.) go into the attrs map
                    this.updateAttribute([patch.target], patch.key, patch.value);
                }
                return undefined;
            }

            if (patch.type === "text") {
                this.spliceValue([patch.target], patch.index, patch.delete, patch.insert);
                return undefined;
            }

            return undefined;
        } catch (e) {
            handleModelError("applyPatch", e);
            return undefined;
        }
    }

    private degeneralizeValue(value: unknown, vars: Map<string, string>): unknown {
        if (typeof value === "string" && value.startsWith("$")) {
            return vars.get(value) || value;
        }
        if (Array.isArray(value)) {
            return value.map((v) => this.degeneralizeValue(v, vars));
        }
        if (value && typeof value === "object") {
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) {
                result[k] = this.degeneralizeValue(v, vars);
            }
            return result;
        }
        return value;
    }

    // === Static Factory Methods ===

    /**
     * Create a new document, optionally with an initial structure
     * @param options Document options
     * @param initializer Optional callback to set up initial document structure
     */
    static create(
        options?: DenicekDocumentOptions,
        initializer?: (doc: DenicekDocument) => void
    ): DenicekDocument {
        const doc = new DenicekDocument(options);
        if (initializer) {
            initializer(doc);
        }
        // Discard diffs accumulated during initialization so they don't pollute history
        doc.recordedDiffs = [];
        return doc;
    }

    // === Cleanup ===

    /**
     * Dispose of the document and clean up subscriptions
     */
    dispose(): void {
        // Cleanup status subscriptions
        this.statusUnsubscribe?.();
        this.latencyUnsubscribe?.();
        // Fire-and-forget sync disconnect to keep dispose() synchronous
        this.disconnectSync().catch(() => {});
        if (this.localUpdateUnsubscribe) {
            this.localUpdateUnsubscribe();
        }
        this.syncStatusListeners.clear();
    }
}
