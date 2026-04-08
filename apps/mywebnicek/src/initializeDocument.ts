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

/** Add a child with an explicit field name */
const addNamed = (doc: DenicekDocument, parentId: string, name: string, child: NodeInput): string => {
    return doc.addNamedChild(parentId, name, child);
};

/** Add a single child (field name derived from tag/kind) and return its ID */
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
    const headerId = addNamed(doc, rootId, "header", el("header"));
    const titleId = addNamed(doc, headerId, "title", el("h1"));
    add(doc, titleId, val("MyDenicek"));
    const subtitleId = addNamed(doc, headerId, "subtitle", el("p"));
    add(doc, subtitleId, val("A local-first collaborative document editor"));

    // Examples
    const examplesId = addNamed(doc, rootId, "examples", el("main"));

    // Example 1: Counter
    const counterId = addNamed(doc, examplesId, "counter", el("article"));
    const counterTitleId = addNamed(doc, counterId, "title", el("h2"));
    add(doc, counterTitleId, val("Counter"));
    const counterDescId = addNamed(doc, counterId, "description", el("p"));
    add(doc, counterDescId, val("Click the buttons to increment/decrement. Uses formula nodes."));
    const counterDisplayId = addNamed(doc, counterId, "display", el("div"));
    add(doc, counterDisplayId, val("0"));
    const counterButtonsId = addNamed(doc, counterId, "buttons", el("div"));
    doc.addChildren(counterButtonsId, [
        action("+1", { target: counterDisplayId }, incrementActions),
        action("-1", { target: counterDisplayId }, decrementActions),
    ]);

    // Example 2: Todo list
    const todoId = addNamed(doc, examplesId, "todoList", el("article"));
    const todoTitleId = addNamed(doc, todoId, "title", el("h2"));
    add(doc, todoTitleId, val("Todo List"));
    const todoItemsId = addNamed(doc, todoId, "items", el("ul"));
    const item1 = addNamed(doc, todoItemsId, "item1", el("li"));
    add(doc, item1, val("Try editing this text"));
    const item2 = addNamed(doc, todoItemsId, "item2", el("li"));
    add(doc, item2, val("Add new items with the toolbar"));
    const item3 = addNamed(doc, todoItemsId, "item3", el("li"));
    add(doc, item3, val("Delete items by selecting and pressing Delete"));

    // Example 3: Conference table
    const confId = addNamed(doc, examplesId, "conferences", el("article"));
    const confTitleId = addNamed(doc, confId, "title", el("h2"));
    add(doc, confTitleId, val("Conferences"));
    const tableId = addNamed(doc, confId, "table", el("table"));
    const theadId = addNamed(doc, tableId, "head", el("thead"));
    const headerRowId = addNamed(doc, theadId, "row", el("tr"));
    const nameColId = addNamed(doc, headerRowId, "name", el("th"));
    add(doc, nameColId, val("Name"));
    const locColId = addNamed(doc, headerRowId, "location", el("th"));
    add(doc, locColId, val("Location"));
    const tbodyId = addNamed(doc, tableId, "body", el("tbody"));
    const ecoop = addNamed(doc, tbodyId, "ecoop", el("tr"));
    const ecoopName = addNamed(doc, ecoop, "name", el("td"));
    add(doc, ecoopName, val("ECOOP 2025"));
    const ecoopLoc = addNamed(doc, ecoop, "location", el("td"));
    add(doc, ecoopLoc, val("Bergen"));
    doc.addChildren(confId, [
        action("Add Conference", { target: tbodyId }, addConferenceActions),
    ]);

    doc.clearHistory();
    doc.clearUndoHistory();
}

