import { beforeEach, describe, expect, it } from "vitest";

import { DenicekDocument } from "./DenicekDocument.js";
import { evaluateFormula, isFormulaError } from "./formula/index.js";
import type { FormulaContext, FormulaDocumentAccessor, NodeData, Operation } from "./types.js";

/** Simple test initializer - creates a minimal document structure */
function testInitializer(doc: DenicekDocument): void {
    const rootId = doc.createRootNode("section");
    doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
}

describe("DenicekDocument", () => {
    let doc: DenicekDocument;

    beforeEach(() => {
        doc = new DenicekDocument();
    });

    describe("basic operations", () => {
        it("should create an empty document", () => {
            expect(doc.getRootId()).toBeNull();
            const snapshot = doc.getSnapshot();
            expect(snapshot.nodes.size).toBe(0);
        });

        it("should create a document with initial structure via initializer", () => {
            doc = DenicekDocument.create({}, (d) => {
                d.createRootNode("section");
            });
            expect(doc.getRootId()).toBeTruthy();
            const snapshot = doc.getSnapshot();
            expect(snapshot.nodes.size).toBe(1);
        });

        it("should add nodes directly", () => {
            doc.createRootNode("root");
            expect(doc.getRootId()).toBeTruthy();
        });
    });

    describe("export/import", () => {
        it("should export and import document", () => {
            doc = DenicekDocument.create({}, testInitializer);
            const bytes = doc.export("snapshot");

            const doc2 = new DenicekDocument();
            doc2.import(bytes);

            expect(doc2.getRootId()).toBe(doc.getRootId());
            expect(doc2.getSnapshot().nodes.size).toBe(doc.getSnapshot().nodes.size);
        });
    });

    describe("subscriptions", () => {
        it("should notify on changes", () => {
            let notified = false;
            doc.subscribe(() => {
                notified = true;
            });

            doc.createRootNode("root");

            expect(notified).toBe(true);
        });
    });

    describe("undo/redo", () => {
        beforeEach(() => {
            doc = DenicekDocument.create({}, testInitializer);
        });

        it("should track canUndo/canRedo state on fresh document", () => {
            // Use a fresh document (not create() which adds initial content)
            const freshDoc = new DenicekDocument();
            expect(freshDoc.canUndo).toBe(false);
            expect(freshDoc.canRedo).toBe(false);
        });

        it("should undo changes", () => {
            const rootId = doc.getRootId()!;
            const [nodeId] = doc.addChildren(rootId, [{ kind: "element", tag: "test", attrs: {}, children: [] }]);

            // Verify node was added
            expect(doc.getNode(nodeId!)).toBeTruthy();

            // Undo should be available now
            expect(doc.canUndo).toBe(true);

            // Undo the change
            doc.undo();

            // Verify node was removed
            expect(doc.getNode(nodeId!)).toBeNull();

            // Redo should be available
            expect(doc.canRedo).toBe(true);
        });
    });

    describe("version change notification", () => {
        it("should notify on version change", () => {
            const versions: number[] = [];
            const docWithCallback = DenicekDocument.create(
                { onVersionChange: (v: number) => versions.push(v) },
                testInitializer
            );

            const rootId = docWithCallback.getRootId()!;
            docWithCallback.addChildren(rootId, [{ kind: "element", tag: "test", attrs: {}, children: [] }]);

            expect(versions.length).toBeGreaterThan(0);
        });
    });
});

describe("DenicekDocument mutations", () => {
    let doc: DenicekDocument;

    beforeEach(() => {
        doc = DenicekDocument.create({}, testInitializer);
    });

    describe("node operations", () => {
        it("should get root node", () => {
            const rootId = doc.getRootId();
            expect(rootId).toBeTruthy();

            const rootNode = doc.getNode(rootId!);
            expect(rootNode).toBeTruthy();
            expect(rootNode?.kind).toBe("element");
        });

        it("should add element child", () => {
            const rootId = doc.getRootId()!;
            const [newId] = doc.addChildren(rootId, [{ kind: "element", tag: "span", attrs: {}, children: [] }]);
            expect(newId).toBeTruthy();

            const newNode = doc.getNode(newId!);
            expect(newNode?.kind).toBe("element");
            if (newNode?.kind === "element") {
                expect(newNode.tag).toBe("span");
            }
        });

        it("should add value child", () => {
            const rootId = doc.getRootId()!;
            // First add an element to hold the value
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);

            const [valueId] = doc.addChildren(containerId!, [{ kind: "value", value: "Hello World" }]);
            expect(valueId).toBeTruthy();

            const valueNode = doc.getNode(valueId!);
            expect(valueNode?.kind).toBe("value");
            if (valueNode?.kind === "value") {
                expect(valueNode.value).toBe("Hello World");
            }
        });

        it("should update tag", () => {
            const rootId = doc.getRootId()!;
            const [newId] = doc.addChildren(rootId, [{ kind: "element", tag: "div", attrs: {}, children: [] }]);
            doc.updateTag([newId!], "span");

            const node = doc.getNode(newId!);
            if (node?.kind === "element") {
                expect(node.tag).toBe("span");
            }
        });

        it("should update attribute", () => {
            const rootId = doc.getRootId()!;
            const [newId] = doc.addChildren(rootId, [{ kind: "element", tag: "div", attrs: {}, children: [] }]);
            doc.updateAttribute([newId!], "class", "container");

            const node = doc.getNode(newId!);
            if (node?.kind === "element") {
                expect(node.attrs.class).toBe("container");
            }
        });

        it("should splice value", () => {
            const rootId = doc.getRootId()!;
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
            const [valueId] = doc.addChildren(containerId!, [{ kind: "value", value: "Hello" }]);

            doc.spliceValue([valueId!], 5, 0, " World");

            const node = doc.getNode(valueId!);
            if (node?.kind === "value") {
                expect(node.value).toBe("Hello World");
            }
        });
    });

    describe("tree operations", () => {
        it("should delete node", () => {
            const rootId = doc.getRootId()!;
            const [nodeId] = doc.addChildren(rootId, [{ kind: "element", tag: "div", attrs: {}, children: [] }]);

            doc.deleteNodes([nodeId!]);
            const node = doc.getNode(nodeId!);
            expect(node).toBeNull();
        });
    });

    describe("copy operations", () => {
        it("should copy an element node with tag and attrs", () => {
            const rootId = doc.getRootId()!;
            const [sourceId] = doc.addChildren(rootId, [{
                kind: "element",
                tag: "div",
                attrs: { class: "source", "data-test": 123 },
                children: []
            }]);

            const copyId = doc.copyNode(sourceId!, rootId);

            const copy = doc.getNode(copyId);
            expect(copy?.kind).toBe("element");
            if (copy?.kind === "element") {
                expect(copy.tag).toBe("div");
                expect(copy.attrs.class).toBe("source");
                expect(copy.attrs["data-test"]).toBe(123);
            }
        });

        it("should copy a value node with current text value", () => {
            const rootId = doc.getRootId()!;
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
            const [sourceId] = doc.addChildren(containerId!, [{ kind: "value", value: "original text" }]);

            const copyId = doc.copyNode(sourceId!, containerId!);

            const copy = doc.getNode(copyId);
            expect(copy?.kind).toBe("value");
            if (copy?.kind === "value") {
                expect(copy.value).toBe("original text");
            }
        });

        it("should store sourceId on the copied element node", () => {
            const rootId = doc.getRootId()!;
            const [sourceId] = doc.addChildren(rootId, [{ kind: "element", tag: "span", attrs: {}, children: [] }]);
            const copyId = doc.copyNode(sourceId!, rootId);

            const copyData = doc.getNode(copyId);
            expect(copyData?.sourceId).toBe(sourceId);
        });

        it("should store sourceId on the copied value node", () => {
            const rootId = doc.getRootId()!;
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
            const [sourceId] = doc.addChildren(containerId!, [{ kind: "value", value: "test" }]);
            const copyId = doc.copyNode(sourceId!, containerId!);

            const copyData = doc.getNode(copyId);
            expect(copyData?.sourceId).toBe(sourceId);
        });

        it("should emit copy patch with sourceId", () => {
            doc.clearHistory();
            const rootId = doc.getRootId()!;
            const [sourceId] = doc.addChildren(rootId, [{ kind: "element", tag: "div", attrs: {}, children: [] }]);
            doc.copyNode(sourceId!, rootId);

            const history = doc.getHistory();
            const copyPatch = history.find(p => p.type === "tree" && p.action === "create" && "sourceId" in p && p.sourceId === sourceId);
            expect(copyPatch).toBeTruthy();
        });

        it("should copy CURRENT value when source is modified before copy", () => {
            const rootId = doc.getRootId()!;
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
            const [sourceId] = doc.addChildren(containerId!, [{ kind: "value", value: "initial" }]);

            // Modify source value
            doc.spliceValue([sourceId!], 0, 7, "modified");

            // Copy should get "modified" value
            const copyId = doc.copyNode(sourceId!, containerId!);

            const copy = doc.getNode(copyId);
            if (copy?.kind === "value") {
                expect(copy.value).toBe("modified");
            }
        });

        it("should read CURRENT value during replay (not value at recording time)", () => {
            // This is the key test for the copy feature:
            // When a copy patch is replayed, it should read the CURRENT value
            // from the source, not the value that existed when the copy was recorded.

            const rootId = doc.getRootId()!;
            const [containerId] = doc.addChildren(rootId, [{ kind: "element", tag: "p", attrs: {}, children: [] }]);
            const [sourceId] = doc.addChildren(containerId!, [{ kind: "value", value: "original" }]);

            // Get count of children before recording
            const snapshotBefore = doc.getSnapshot();
            const childrenBefore = snapshotBefore.childIds.get(containerId!) ?? [];
            const childCountBeforeRecording = childrenBefore.length;

            // Record a copy operation
            doc.clearHistory();
            doc.copyNode(sourceId!, containerId!);
            const copyScript = doc.getHistory();

            // Get count of children after recording (includes the first copy)
            const snapshotAfterRecording = doc.getSnapshot();
            const childrenAfterRecording = snapshotAfterRecording.childIds.get(containerId!) ?? [];
            const childCountAfterRecording = childrenAfterRecording.length;
            expect(childCountAfterRecording).toBe(childCountBeforeRecording + 1);

            // Now modify the source value AFTER recording
            doc.spliceValue([sourceId!], 0, 8, "updated");

            // Verify source is now "updated"
            const sourceNode = doc.getNode(sourceId!);
            if (sourceNode?.kind === "value") {
                expect(sourceNode.value).toBe("updated");
            }

            // Replay the copy script - should create another copy with "updated"
            doc.replay(copyScript, { "0": containerId! });

            // Now we should have one more child
            const snapshotAfterReplay = doc.getSnapshot();
            const childrenAfterReplay = snapshotAfterReplay.childIds.get(containerId!) ?? [];
            expect(childrenAfterReplay.length).toBe(childCountAfterRecording + 1);

            // At least one copy should have "updated" (the replayed one)
            const allCopiesWithUpdated = childrenAfterReplay
                .filter(id => id !== sourceId)
                .map(id => doc.getNode(id))
                .filter(node => node?.kind === "value" && node.value === "updated");

            expect(allCopiesWithUpdated.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("history: map patches", () => {
        it("should include map patches for tag rename after clearHistory", () => {
            doc = DenicekDocument.create({}, testInitializer);
            doc.clearHistory();

            const rootId = doc.getRootId()!;
            doc.updateTag([rootId], "section-test");

            const history = doc.getHistory();
            const mapPatches = history.filter(p => p.type === "map");
            expect(mapPatches.length).toBeGreaterThan(0);
            const tagPatch = mapPatches.find(p => p.type === "map" && p.key === "tag");
            expect(tagPatch).toBeTruthy();
        });

        it("should have empty history after create() (initialization discarded)", () => {
            doc = DenicekDocument.create({}, testInitializer);
            const history = doc.getHistory();
            expect(history.length).toBe(0);
        });

        it("should preserve intermediate changes (two renames produce two patches)", () => {
            doc = DenicekDocument.create({}, testInitializer);
            doc.clearHistory();

            const rootId = doc.getRootId()!;
            doc.updateTag([rootId], "h3");
            doc.updateTag([rootId], "h4");

            const history = doc.getHistory();
            const tagPatches = history.filter(p => p.type === "map" && p.key === "tag");
            expect(tagPatches.length).toBe(2);
            expect(tagPatches[0]!.type === "map" && tagPatches[0]!.value).toBe("h3");
            expect(tagPatches[1]!.type === "map" && tagPatches[1]!.value).toBe("h4");
        });

        it("should suppress initialization map patches for newly created nodes", () => {
            doc = DenicekDocument.create({}, testInitializer);
            doc.clearHistory();

            const rootId = doc.getRootId()!;
            doc.addChildren(rootId, [{ kind: "element", tag: "li", attrs: {}, children: [] }]);

            const history = doc.getHistory();
            // Should only have a tree create patch, no map patches (kind, tag, attrs are suppressed)
            expect(history.filter(p => p.type === "tree").length).toBe(1);
            expect(history.filter(p => p.type === "map").length).toBe(0);
        });

        it("should preserve node data in history after undo deletes the node", () => {
            doc = DenicekDocument.create({}, testInitializer);
            doc.clearHistory();

            const rootId = doc.getRootId()!;
            doc.addChildren(rootId, [{ kind: "element", tag: "li", attrs: {}, children: [] }]);

            // Undo deletes the node from the tree
            doc.undo();

            const history = doc.getHistory();
            // Should have a create and a delete
            const creates = history.filter(p => p.type === "tree" && p.action === "create");
            expect(creates.length).toBe(1);
            // The create should still have the correct tag, not fallback "div"
            const create = creates[0]!;
            expect(create.type === "tree" && create.action === "create" && create.data?.kind).toBe("element");
            if (create.type === "tree" && create.action === "create" && create.data?.kind === "element") {
                expect(create.data.tag).toBe("li");
            }
        });

        it("should show actual text value for value node creates, not container reference", () => {
            doc = DenicekDocument.create({}, testInitializer);
            doc.clearHistory();

            const rootId = doc.getRootId()!;
            doc.addChildren(rootId, [{ kind: "value", value: "hello" }]);

            const history = doc.getHistory();
            const creates = history.filter(p => p.type === "tree" && p.action === "create");
            expect(creates.length).toBe(1);
            const create = creates[0]!;
            expect(create.type === "tree" && create.action === "create" && create.data?.kind).toBe("value");
            if (create.type === "tree" && create.action === "create" && create.data?.kind === "value") {
                expect(create.data.value).toBe("hello");
            }
        });
    });
});

// =============================================================================
// RPN Sibling Stack Evaluation Tests
// =============================================================================

/** Helper to build a mock document for formula evaluation tests */
function buildMockContext(
    nodes: Map<string, NodeData>,
    children: Map<string, string[]>,
    parents: Map<string, string | null>,
    ops: Operation[],
): FormulaContext {
    const document: FormulaDocumentAccessor = {
        getNode: (id) => nodes.get(id),
        getChildIds: (id) => children.get(id) ?? [],
        getParentId: (id) => parents.get(id) ?? null,
    };
    return {
        document,
        operations: new Map(ops.map(op => [op.name, op])),
    };
}

const capitalize: Operation = {
    name: "capitalize",
    arity: 1,
    execute: ([s]) => {
        const str = String(s);
        return str.charAt(0).toUpperCase() + str.slice(1);
    },
};

const lowerText: Operation = {
    name: "lowerText",
    arity: 1,
    execute: ([s]) => String(s).toLowerCase(),
};

const addOp: Operation = {
    name: "add",
    arity: 2,
    execute: ([a, b]) => Number(a) + Number(b),
};

const divideOp: Operation = {
    name: "divide",
    arity: 2,
    execute: ([a, b]) => Number(a) / Number(b),
};

const concatOp: Operation = {
    name: "concat",
    arity: -1,
    execute: (args) => args.map(String).join(""),
};

describe("RPN Sibling Stack Evaluation", () => {
    it("unary: val, capitalize", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "li", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "hello" }],
            ["f1", { id: "f1", kind: "formula", operation: "capitalize" }],
        ]);
        const children = new Map([["parent", ["v1", "f1"]], ["f1", []]]);
        const parents = new Map([["v1", "parent"], ["f1", "parent"]]);
        const ctx = buildMockContext(nodes, children, parents, [capitalize]);

        expect(evaluateFormula("f1", ctx)).toBe("Hello");
    });

    it("chained: val, lowerText, capitalize", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "li", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "hELLo" }],
            ["f1", { id: "f1", kind: "formula", operation: "lowerText" }],
            ["f2", { id: "f2", kind: "formula", operation: "capitalize" }],
        ]);
        const children = new Map([["parent", ["v1", "f1", "f2"]], ["f1", []], ["f2", []]]);
        const parents = new Map([["v1", "parent"], ["f1", "parent"], ["f2", "parent"]]);
        const ctx = buildMockContext(nodes, children, parents, [lowerText, capitalize]);

        expect(evaluateFormula("f1", ctx)).toBe("hello");
        expect(evaluateFormula("f2", ctx)).toBe("Hello");
    });

    it("binary: val, val, add", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "10" }],
            ["v2", { id: "v2", kind: "value", value: "5" }],
            ["f1", { id: "f1", kind: "formula", operation: "add" }],
        ]);
        const children = new Map([["parent", ["v1", "v2", "f1"]], ["f1", []]]);
        const parents = new Map([["v1", "parent"], ["v2", "parent"], ["f1", "parent"]]);
        const ctx = buildMockContext(nodes, children, parents, [addOp]);

        expect(evaluateFormula("f1", ctx)).toBe(15);
    });

    it("complex RPN: (1/2) + (1/3)", () => {
        // 1 2 divide 1 3 divide add
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "1" }],
            ["v2", { id: "v2", kind: "value", value: "2" }],
            ["f1", { id: "f1", kind: "formula", operation: "divide" }],
            ["v3", { id: "v3", kind: "value", value: "1" }],
            ["v4", { id: "v4", kind: "value", value: "3" }],
            ["f2", { id: "f2", kind: "formula", operation: "divide" }],
            ["f3", { id: "f3", kind: "formula", operation: "add" }],
        ]);
        const children = new Map([
            ["parent", ["v1", "v2", "f1", "v3", "v4", "f2", "f3"]],
            ["f1", []], ["f2", []], ["f3", []],
        ]);
        const parents = new Map([
            ["v1", "parent"], ["v2", "parent"], ["f1", "parent"],
            ["v3", "parent"], ["v4", "parent"], ["f2", "parent"], ["f3", "parent"],
        ]);
        const ctx = buildMockContext(nodes, children, parents, [divideOp, addOp]);

        const result = evaluateFormula("f3", ctx);
        expect(result).toBeCloseTo(1/2 + 1/3);
    });

    it("chained adds: val, val, add, val, add", () => {
        // 5 + 1 + 1 = 7
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "5" }],
            ["v2", { id: "v2", kind: "value", value: "1" }],
            ["f1", { id: "f1", kind: "formula", operation: "add" }],
            ["v3", { id: "v3", kind: "value", value: "1" }],
            ["f2", { id: "f2", kind: "formula", operation: "add" }],
        ]);
        const children = new Map([
            ["parent", ["v1", "v2", "f1", "v3", "f2"]],
            ["f1", []], ["f2", []],
        ]);
        const parents = new Map([
            ["v1", "parent"], ["v2", "parent"], ["f1", "parent"],
            ["v3", "parent"], ["f2", "parent"],
        ]);
        const ctx = buildMockContext(nodes, children, parents, [addOp]);

        expect(evaluateFormula("f2", ctx)).toBe(7);
    });

    it("variadic consumes entire stack: val, val, val, concat", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "a" }],
            ["v2", { id: "v2", kind: "value", value: "b" }],
            ["v3", { id: "v3", kind: "value", value: "c" }],
            ["f1", { id: "f1", kind: "formula", operation: "concat" }],
        ]);
        const children = new Map([["parent", ["v1", "v2", "v3", "f1"]], ["f1", []]]);
        const parents = new Map([
            ["v1", "parent"], ["v2", "parent"], ["v3", "parent"], ["f1", "parent"],
        ]);
        const ctx = buildMockContext(nodes, children, parents, [concatOp]);

        expect(evaluateFormula("f1", ctx)).toBe("abc");
    });

    it("error: not enough operands on stack", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "5" }],
            ["f1", { id: "f1", kind: "formula", operation: "add" }],
        ]);
        const children = new Map([["parent", ["v1", "f1"]], ["f1", []]]);
        const parents = new Map([["v1", "parent"], ["f1", "parent"]]);
        const ctx = buildMockContext(nodes, children, parents, [addOp]);

        const result = evaluateFormula("f1", ctx);
        expect(isFormulaError(result)).toBe(true);
    });

    it("hybrid: formula with children uses child-based evaluation", () => {
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["f1", { id: "f1", kind: "formula", operation: "add" }],
            ["c1", { id: "c1", kind: "value", value: "10" }],
            ["c2", { id: "c2", kind: "value", value: "20" }],
        ]);
        const children = new Map([["parent", ["f1"]], ["f1", ["c1", "c2"]]]);
        const parents = new Map([["f1", "parent"], ["c1", "f1"], ["c2", "f1"]]);
        const ctx = buildMockContext(nodes, children, parents, [addOp]);

        expect(evaluateFormula("f1", ctx)).toBe(30);
    });

    it("element siblings are skipped in stack evaluation", () => {
        // span("label"), val(5), val(1), add => only val nodes participate
        const nodes = new Map<string, NodeData>([
            ["parent", { id: "parent", kind: "element", tag: "div", attrs: {} }],
            ["span", { id: "span", kind: "element", tag: "span", attrs: {} }],
            ["v1", { id: "v1", kind: "value", value: "5" }],
            ["v2", { id: "v2", kind: "value", value: "1" }],
            ["f1", { id: "f1", kind: "formula", operation: "add" }],
        ]);
        const children = new Map([["parent", ["span", "v1", "v2", "f1"]], ["f1", []], ["span", []]]);
        const parents = new Map([
            ["span", "parent"], ["v1", "parent"], ["v2", "parent"], ["f1", "parent"],
        ]);
        const ctx = buildMockContext(nodes, children, parents, [addOp]);

        expect(evaluateFormula("f1", ctx)).toBe(6);
    });
});
