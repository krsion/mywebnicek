/**
 * @mydenicek/document
 *
 * Document abstraction layer backed by @mydenicek/core CRDT engine.
 * No CRDT internals are exposed - all details are hidden behind DenicekDocument.
 */

// Main classes
export type { DenicekDocumentOptions, NodeInput, SyncOptions } from "./DenicekDocument.js";
export { DenicekDocument } from "./DenicekDocument.js";

// Types
export type {
    ActionNodeData,
    ElementNodeData,
    FormulaContext,
    FormulaDocumentAccessor,
    FormulaNodeData,
    GeneralizedPatch,
    GroupedPatch,
    MapPatch,
    NodeData,
    Operation,
    OpId,
    PatchNodeData,
    RefNodeData,
    Snapshot,
    SpliceInfo,
    SyncState,
    SyncStatus,
    TextPatch,
    TreePatch,
    ValueNodeData,
    Version
} from "./types.js";

// Formula engine
export { evaluateFormula, getNodeValue, isFormulaError } from "./formula/index.js";

