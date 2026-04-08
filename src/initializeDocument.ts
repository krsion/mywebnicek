/**
 * Default document initialization for the web app.
 *
 * Uses the raw Denicek CRDT API directly.
 * Records have HTML tags. Text is stored as primitive strings.
 */

import type { Denicek } from "@mydenicek/core";

/** Shorthand: add an element record with a valid HTML tag. */
function el(dk: Denicek, path: string, name: string, tag: string): void {
    dk.add(path, name, { $tag: tag });
}

/**
 * Initialize a document with a simple starter structure.
 */
export function initializeDocument(dk: Denicek): void {
    // Root
    el(dk, "", "root", "section");

    // Header
    el(dk, "root", "header", "header");
    el(dk, "root/header", "title", "h1");
    dk.add("root/header/title", "text", "mywebnicek");
    el(dk, "root/header", "subtitle", "p");
    dk.add("root/header/subtitle", "text", "A local-first collaborative document editor");

    // Examples container
    el(dk, "root", "examples", "main");

    // Example 1: Counter
    el(dk, "root/examples", "counter", "article");
    el(dk, "root/examples/counter", "heading", "h2");
    dk.add("root/examples/counter/heading", "text", "Counter");
    el(dk, "root/examples/counter", "value", "p");
    dk.add("root/examples/counter/value", "count", 0);

    // Example 2: Todo list
    el(dk, "root/examples", "todoList", "article");
    el(dk, "root/examples/todoList", "heading", "h2");
    dk.add("root/examples/todoList/heading", "text", "Todo List");
    el(dk, "root/examples/todoList", "items", "ul");
    el(dk, "root/examples/todoList/items", "item1", "li");
    dk.add("root/examples/todoList/items/item1", "text", "Try editing this text");
    el(dk, "root/examples/todoList/items", "item2", "li");
    dk.add("root/examples/todoList/items/item2", "text", "Add new items with the command bar");
    el(dk, "root/examples/todoList/items", "item3", "li");
    dk.add("root/examples/todoList/items/item3", "text", "Delete items with: delete /path field");

    // Example 3: Conference table
    el(dk, "root/examples", "conferences", "article");
    el(dk, "root/examples/conferences", "heading", "h2");
    dk.add("root/examples/conferences/heading", "text", "Conferences");
    el(dk, "root/examples/conferences", "table", "table");
    el(dk, "root/examples/conferences/table", "head", "thead");
    el(dk, "root/examples/conferences/table/head", "headerRow", "tr");
    el(dk, "root/examples/conferences/table/head/headerRow", "name", "th");
    dk.add("root/examples/conferences/table/head/headerRow/name", "text", "Name");
    el(dk, "root/examples/conferences/table/head/headerRow", "location", "th");
    dk.add("root/examples/conferences/table/head/headerRow/location", "text", "Location");
    el(dk, "root/examples/conferences/table", "body", "tbody");
    el(dk, "root/examples/conferences/table/body", "ecoop", "tr");
    el(dk, "root/examples/conferences/table/body/ecoop", "name", "td");
    dk.add("root/examples/conferences/table/body/ecoop/name", "text", "ECOOP 2025");
    el(dk, "root/examples/conferences/table/body/ecoop", "location", "td");
    dk.add("root/examples/conferences/table/body/ecoop/location", "text", "Bergen");
}


