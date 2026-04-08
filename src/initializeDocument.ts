/**
 * Default document initialization for the web app.
 *
 * Uses the raw Denicek CRDT API directly — no adapter layer.
 * Primitive values are stored as plain strings (no $value wrappers).
 */

import type { Denicek, PlainNode } from "@mydenicek/core";

/** Shorthand for creating action records */
function actionNode(label: string, target: string, patches: ActionPatch[]): PlainNode {
    return {
        $tag: "$action",
        label,
        actions: JSON.stringify(patches),
        params: JSON.stringify({ target }),
    } as unknown as PlainNode;
}

interface ActionPatch {
    type: string;
    action?: string;
    target: string;
    parent?: string;
    index?: number;
    data?: Record<string, unknown>;
    key?: string;
    value?: unknown;
}

/** Actions for "+1" button */
const incrementActions: ActionPatch[] = [
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "value", value: "1" } },
    { type: "tree", action: "create", target: "$2", parent: "$target", index: -1, data: { kind: "formula", operation: "add" } },
];

/** Actions for "-1" button */
const decrementActions: ActionPatch[] = [
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "value", value: "-1" } },
    { type: "tree", action: "create", target: "$2", parent: "$target", index: -1, data: { kind: "formula", operation: "add" } },
];

/** Actions for "Add Conference" button */
const addConferenceActions: ActionPatch[] = [
    { type: "tree", action: "create", target: "$1", parent: "$target", index: -1, data: { kind: "element", tag: "tr" } },
    { type: "tree", action: "create", target: "$2", parent: "$1", index: -1, data: { kind: "element", tag: "td" } },
    { type: "map", target: "$2", key: "style", value: { padding: 8 } },
    { type: "tree", action: "create", target: "$3", parent: "$2", index: -1, data: { kind: "value", value: "New Conference" } },
    { type: "tree", action: "create", target: "$4", parent: "$1", index: -1, data: { kind: "element", tag: "td" } },
    { type: "map", target: "$4", key: "style", value: { padding: 8 } },
    { type: "tree", action: "create", target: "$5", parent: "$4", index: -1, data: { kind: "value", value: "Location" } },
];

/**
 * Initialize a document with a simple starter structure.
 * Demonstrates elements, text values, and action buttons.
 */
export function initializeDocument(dk: Denicek): void {
    // Root
    dk.add("", "root", { $tag: "section" } as unknown as PlainNode);

    // Header
    dk.add("root", "header", { $tag: "header" } as unknown as PlainNode);
    dk.add("root/header", "title", { $tag: "h1" } as unknown as PlainNode);
    dk.add("root/header/title", "text", "MyDenicek");
    dk.add("root/header", "subtitle", { $tag: "p" } as unknown as PlainNode);
    dk.add("root/header/subtitle", "text", "A local-first collaborative document editor");

    // Examples container
    dk.add("root", "examples", { $tag: "main" } as unknown as PlainNode);

    // Example 1: Counter
    dk.add("root/examples", "counter", { $tag: "article" } as unknown as PlainNode);
    dk.add("root/examples/counter", "title", { $tag: "h2" } as unknown as PlainNode);
    dk.add("root/examples/counter/title", "text", "Counter");
    dk.add("root/examples/counter", "description", { $tag: "p" } as unknown as PlainNode);
    dk.add("root/examples/counter/description", "text", "Click the buttons to increment/decrement. Uses formula nodes.");
    dk.add("root/examples/counter", "display", { $tag: "div" } as unknown as PlainNode);
    dk.add("root/examples/counter/display", "text", "0");
    dk.add("root/examples/counter", "buttons", { $tag: "div" } as unknown as PlainNode);
    dk.add("root/examples/counter/buttons", "increment", actionNode("+1", "root/examples/counter/display", incrementActions));
    dk.add("root/examples/counter/buttons", "decrement", actionNode("-1", "root/examples/counter/display", decrementActions));

    // Example 2: Todo list
    dk.add("root/examples", "todoList", { $tag: "article" } as unknown as PlainNode);
    dk.add("root/examples/todoList", "title", { $tag: "h2" } as unknown as PlainNode);
    dk.add("root/examples/todoList/title", "text", "Todo List");
    dk.add("root/examples/todoList", "items", { $tag: "ul" } as unknown as PlainNode);
    dk.add("root/examples/todoList/items", "item1", { $tag: "li" } as unknown as PlainNode);
    dk.add("root/examples/todoList/items/item1", "text", "Try editing this text");
    dk.add("root/examples/todoList/items", "item2", { $tag: "li" } as unknown as PlainNode);
    dk.add("root/examples/todoList/items/item2", "text", "Add new items with the toolbar");
    dk.add("root/examples/todoList/items", "item3", { $tag: "li" } as unknown as PlainNode);
    dk.add("root/examples/todoList/items/item3", "text", "Delete items by selecting and pressing Delete");

    // Example 3: Conference table
    dk.add("root/examples", "conferences", { $tag: "article" } as unknown as PlainNode);
    dk.add("root/examples/conferences", "title", { $tag: "h2" } as unknown as PlainNode);
    dk.add("root/examples/conferences/title", "text", "Conferences");
    dk.add("root/examples/conferences", "table", { $tag: "table" } as unknown as PlainNode);
    dk.add("root/examples/conferences/table", "head", { $tag: "thead" } as unknown as PlainNode);
    dk.add("root/examples/conferences/table/head", "row", { $tag: "tr" } as unknown as PlainNode);
    dk.add("root/examples/conferences/table/head/row", "name", { $tag: "th" } as unknown as PlainNode);
    dk.add("root/examples/conferences/table/head/row/name", "text", "Name");
    dk.add("root/examples/conferences/table/head/row", "location", { $tag: "th" } as unknown as PlainNode);
    dk.add("root/examples/conferences/table/head/row/location", "text", "Location");
    dk.add("root/examples/conferences", "body", { $tag: "tbody" } as unknown as PlainNode);
    dk.add("root/examples/conferences/body", "ecoop", { $tag: "tr" } as unknown as PlainNode);
    dk.add("root/examples/conferences/body/ecoop", "name", { $tag: "td" } as unknown as PlainNode);
    dk.add("root/examples/conferences/body/ecoop/name", "text", "ECOOP 2025");
    dk.add("root/examples/conferences/body/ecoop", "location", { $tag: "td" } as unknown as PlainNode);
    dk.add("root/examples/conferences/body/ecoop/location", "text", "Bergen");
    dk.add("root/examples/conferences", "addButton", actionNode("Add Conference", "root/examples/conferences/body", addConferenceActions));
}


