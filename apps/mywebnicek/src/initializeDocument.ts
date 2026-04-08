/**
 * Default document initialization for the web app
 *
 * This creates formative examples from the specification that demonstrate
 * the end-user programming model of Denicek.
 */

import type { DenicekDocument, GeneralizedPatch, NodeInput } from "@mydenicek/document";

/** Shorthand for creating element nodes */
const el = (tag: string) => ({ kind: "element" as const, tag, attrs: {}, children: [] });
/** Shorthand for creating value nodes */
const val = (value: string) => ({ kind: "value" as const, value });
/** Shorthand for creating action nodes (programmable buttons) */
const action = (label: string, params: Record<string, string>, actions: GeneralizedPatch[] = []) =>
    ({ kind: "action" as const, label, actions, params });

/** Add a single child and return its ID (throws if creation fails) */
const add = (doc: DenicekDocument, parentId: string, child: NodeInput): string => {
    const [id] = doc.addChildren(parentId, [child]);
    if (!id) throw new Error("Failed to create node");
    return id;
};

// ============================================================================
// Pre-programmed actions for buttons
// ============================================================================

/** Actions for "Add Conference" button */
const addConferenceActions: GeneralizedPatch[] = [
    // Insert new tr element as child of tbody ($target)
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "element", tag: "tr" } },
    // Insert first td (name)
    { type: "tree", action: "create", target: "$2", parent: "$1", index: -1, data: { kind: "element", tag: "td" } },
    { type: "map", target: "$2", key: "style", value: { padding: 8 } },
    { type: "tree", action: "create", target: "$3", parent: "$2", index: -1, data: { kind: "value", value: "New Conference" } },
    // Insert second td (location)
    { type: "tree", action: "create", target: "$4", parent: "$1", index: -1, data: { kind: "element", tag: "td" } },
    { type: "map", target: "$4", key: "style", value: { padding: 8 } },
    { type: "tree", action: "create", target: "$5", parent: "$4", index: -1, data: { kind: "value", value: "Location" } },
];

/** Actions for "+1" button - add value and RPN add formula as siblings in counter display */
const incrementActions: GeneralizedPatch[] = [
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "value", value: "1" } },
    { type: "tree", action: "create", target: "$2", parent: "$target", index: -1, data: { kind: "formula", operation: "add" } },
];

/** Actions for "-1" button - add value "-1" and RPN add formula as siblings in counter display */
const decrementActions: GeneralizedPatch[] = [
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "value", value: "-1" } },
    { type: "tree", action: "create", target: "$2", parent: "$target", index: -1, data: { kind: "formula", operation: "add" } },
];

/**
 * Initialize a document with a simple starter structure.
 * Demonstrates the core node types: elements, values, formulas, refs, and actions.
 */
export function initializeDocument(doc: DenicekDocument): void {
    const rootId = doc.createRootNode("section");

    // Header
    const headerId = add(doc, rootId, el("header"));
    const h1Id = add(doc, headerId, el("h1"));
    add(doc, h1Id, val("MyDenicek"));
    const subtitleId = add(doc, headerId, el("p"));
    add(doc, subtitleId, val("A local-first collaborative document editor"));

    // Main content
    const mainId = add(doc, rootId, el("main"));

    // Example 1: Simple counter with formulas
    const counterSection = add(doc, mainId, el("article"));
    const counterTitle = add(doc, counterSection, el("h2"));
    add(doc, counterTitle, val("Counter"));
    const counterDesc = add(doc, counterSection, el("p"));
    add(doc, counterDesc, val("Click the buttons to increment/decrement. Uses formula nodes."));
    const counterDisplayId = add(doc, counterSection, el("div"));
    add(doc, counterDisplayId, val("0"));
    const buttonsId = add(doc, counterSection, el("div"));
    doc.addChildren(buttonsId, [
        action("+1", { target: counterDisplayId }, incrementActions),
        action("-1", { target: counterDisplayId }, decrementActions),
    ]);

    // Example 2: Todo list
    const todoSection = add(doc, mainId, el("article"));
    const todoTitle = add(doc, todoSection, el("h2"));
    add(doc, todoTitle, val("Todo List"));
    const todoListId = add(doc, todoSection, el("ul"));
    const todo1 = add(doc, todoListId, el("li"));
    add(doc, todo1, val("Try editing this text"));
    const todo2 = add(doc, todoListId, el("li"));
    add(doc, todo2, val("Add new items with the toolbar"));
    const todo3 = add(doc, todoListId, el("li"));
    add(doc, todo3, val("Delete items by selecting and pressing Delete"));

    // Example 3: Conference table
    const confSection = add(doc, mainId, el("article"));
    const confTitle = add(doc, confSection, el("h2"));
    add(doc, confTitle, val("Conferences"));
    const tableId = add(doc, confSection, el("table"));
    const theadId = add(doc, tableId, el("thead"));
    const headerRow = add(doc, theadId, el("tr"));
    const th1 = add(doc, headerRow, el("th"));
    add(doc, th1, val("Name"));
    const th2 = add(doc, headerRow, el("th"));
    add(doc, th2, val("Location"));
    const tbodyId = add(doc, tableId, el("tbody"));
    const row1 = add(doc, tbodyId, el("tr"));
    const td1 = add(doc, row1, el("td"));
    add(doc, td1, val("ECOOP 2025"));
    const td2 = add(doc, row1, el("td"));
    add(doc, td2, val("Bergen"));
    doc.addChildren(confSection, [
        action("Add Conference", { target: tbodyId }, addConferenceActions),
    ]);

    doc.clearHistory();
    doc.clearUndoHistory();
}

