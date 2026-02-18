/**
 * Public types for mydenicek-core
 * No Loro types are exposed - all internal CRDT details are hidden
 */


// ============================================================================
// Public Node Data Types
// ============================================================================

/**
 * Element node data - public read-only view of an element node
 * Children are accessed via DenicekDocument.getChildIds(), not stored here
 */
export interface ElementNodeData {
    id: string;
    kind: "element";
    tag: string;
    attrs: Record<string, unknown>;
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Value node data - public read-only view of a text content node
 */
export interface ValueNodeData {
    id: string;
    kind: "value";
    value: string | number;  // Supports both strings and numbers for formulas
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Action node data - public read-only view of a programmable button node
 * Actions are stored in a LoroList internally for editability
 */
export interface ActionNodeData {
    id: string;
    kind: "action";
    label: string;
    actions: GeneralizedPatch[];
    params: Record<string, string>;  // Named parameters: param name -> node ID
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Ref node data - references another node's value
 */
export interface RefNodeData {
    id: string;
    kind: "ref";
    target: string;  // ID of the referenced node
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Formula node data - computes a value from children using an operation
 */
export interface FormulaNodeData {
    id: string;
    kind: "formula";
    operation: string;  // Operation name - implementation must be registered
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Union type for public node data
 */
export type NodeData = ElementNodeData | ValueNodeData | ActionNodeData | RefNodeData | FormulaNodeData;

/**
 * Immutable snapshot of document state for temporal comparisons.
 * Use DenicekDocument methods for live document access.
 */
export interface Snapshot {
    readonly nodes: ReadonlyMap<string, NodeData>;
    readonly parents: ReadonlyMap<string, string | null>;
    readonly childIds: ReadonlyMap<string, readonly string[]>;
    readonly rootId: string | null;
}


// ============================================================================
// Internal Node Types (Loro types used here are not exported publicly)
// ============================================================================

import type { LoroList, LoroText } from "loro-crdt";

/**
 * Internal element node - includes children IDs for tree operations
 * @internal
 */
export interface ElementNode {
    kind: "element";
    tag: string;
    attrs: Record<string, unknown>;
    children: string[];
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Internal value node - uses LoroText for CRDT text operations
 * @internal
 */
export interface ValueNode {
    kind: "value";
    value: LoroText;
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Internal action node - programmable button with LoroList for actions
 * @internal
 */
export interface ActionNode {
    kind: "action";
    label: string;
    actions: LoroList;  // LoroList for CRDT list operations
    params: Record<string, string>;  // Named parameters: param name -> node ID
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Internal ref node - references another node's value
 * @internal
 */
export interface RefNode {
    kind: "ref";
    target: string;  // ID of the referenced node
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Internal formula node - computes a value from children using an operation
 * @internal
 */
export interface FormulaNode {
    kind: "formula";
    operation: string;  // Operation name
    sourceId?: string;  // Reference to source node if this is a copy
}

/**
 * Internal union type for all node types
 * @internal
 */
export type Node = ElementNode | ValueNode | ActionNode | RefNode | FormulaNode;


/**
 * Splice info for text operations
 */
export interface SpliceInfo {
    index: number;
    deleteCount: number;
    insertText: string;
}

/**
 * OpId represents a single operation ID (peer + counter)
 */
export interface OpId {
    peer: string;
    counter: number;
}

/**
 * Version is an array of OpIds (frontiers in Loro terminology)
 */
export type Version = OpId[];

/**
 * Generalized patch types for recording/replay - aligned with Loro diff format
 */

/** Inline node template for pre-programmed create patches (no existing node to copy from) */
export type PatchNodeData =
    | { kind: "element"; tag: string; attrs?: Record<string, unknown> }
    | { kind: "value"; value: string }
    | { kind: "ref"; target: string }
    | { kind: "formula"; operation: string };

/** Tree structure patches - create, delete, move nodes */
export type TreePatch =
    | { type: "tree"; action: "create"; target: string; parent: string; index: number; sourceId?: string; data?: PatchNodeData }
    | { type: "tree"; action: "delete"; target: string }
    | { type: "tree"; action: "move"; target: string; parent: string; index: number };

/** Map patches - attribute/property updates */
export interface MapPatch {
    type: "map";
    target: string;
    key: string;
    value: unknown;
}

/** Text patches - splice operations on value nodes */
export interface TextPatch {
    type: "text";
    target: string;
    index: number;
    delete: number;
    insert: string;
}

/** Union type for all patch types */
export type GeneralizedPatch = TreePatch | MapPatch | TextPatch;

/** Grouped patches for UI display - groups operations by target node */
export interface GroupedPatch {
    target: string;
    operations: GeneralizedPatch[];
}


// ============================================================================
// Sync Types
// ============================================================================

/**
 * Connection status values matching loro-websocket
 * - "idle": Never connected (initial state)
 * - "connecting": Connection attempt in progress
 * - "connected": WebSocket open and syncing
 * - "disconnected": Connection lost, will auto-retry
 */
export type SyncStatus = "connecting" | "connected" | "disconnected" | "idle";

/**
 * Extended sync state for UI consumption
 */
export interface SyncState {
    status: SyncStatus;
    latency: number | undefined;
    roomId: string | null;
    error: string | null;
}


// ============================================================================
// Formula Types
// ============================================================================

/**
 * Document accessor interface for formula evaluation
 * Avoids circular dependency with DenicekDocument
 */
export interface FormulaDocumentAccessor {
    getNode(id: string): NodeData | undefined;
    getChildIds(id: string): string[];
    getParentId(id: string): string | null;
}

/**
 * Operation definition for formula evaluation
 */
export interface Operation {
    name: string;
    arity: number;  // -1 for variadic
    execute: (args: unknown[], context: FormulaContext) => unknown;
}

/**
 * Context passed to formula evaluation
 */
export interface FormulaContext {
    operations: Map<string, Operation>;
    document: FormulaDocumentAccessor;
}
