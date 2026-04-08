/**
 * Integration tests for sync server and clients
 *
 * These tests:
 * 1. Spawn the actual sync server as a subprocess
 * 2. Connect two clients using document.connectToSync()
 * 3. Verify changes sync between clients
 * 4. Verify server logs show expected activity
 */

import { DenicekDocument, type NodeData } from "@mydenicek/document";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    type ServerProcessContext,
    startServerProcess,
    stopServerProcess,
} from "./helpers/server-process.js";

const ROOM_ID = "test-room";

describe("Sync Integration", () => {
    let server: ServerProcessContext;
    let doc1: DenicekDocument;
    let doc2: DenicekDocument;

    beforeAll(async () => {
        // Start the server process
        server = await startServerProcess();
    }, 15000);

    afterAll(async () => {
        // Clean up - dispose handles sync disconnection
        if (doc1) doc1.dispose();
        if (doc2) doc2.dispose();

        // Stop the server
        await stopServerProcess(server);
    }, 10000);

    it("should start server and show listening log", () => {
        const logs = server.getLogs();
        const listeningLog = logs.find((log) => log.includes("listening on"));
        expect(listeningLog).toBeDefined();
        expect(listeningLog).toContain(`0.0.0.0:${server.port}`);
    });

    it("should connect two clients and sync changes", async () => {
        // Create DenicekDocuments (empty, no initial content)
        doc1 = new DenicekDocument({ peerId: 1n });
        doc2 = new DenicekDocument({ peerId: 2n });

        // Connect both documents to the same room using built-in sync
        await doc1.connectToSync({ url: server.url, roomId: ROOM_ID, pingIntervalMs: 1000 });
        await doc2.connectToSync({ url: server.url, roomId: ROOM_ID, pingIntervalMs: 1000 });

        // Initialize and make changes
        const rootId = doc1.createRootNode("section");
        const [nodeId] = doc1.addChildren(rootId, [{ kind: "element", tag: "test-element", attrs: {}, children: [] }]);
        doc1.updateAttribute([nodeId!], "testAttr", "fromClient1");

        // Wait for sync
        await waitForSync(doc1, doc2, 5000);

        // Verify client 2 sees the changes from client 1
        const nodes2 = doc2.getAllNodes();
        const testNode = findNodeByTag(nodes2, "test-element");
        expect(testNode).toBeDefined();
        if (testNode?.kind === "element") {
            expect(testNode.attrs.testAttr).toBe("fromClient1");
        }

        // Client 2 makes changes
        const rootId2 = doc2.getRootId()!;
        const [nodeId2] = doc2.addChildren(rootId2, [{ kind: "element", tag: "test-element-2", attrs: {}, children: [] }]);
        doc2.updateAttribute([nodeId2!], "testAttr", "fromClient2");

        // Wait for sync
        await waitForSync(doc1, doc2, 5000);

        // Verify client 1 sees the changes from client 2
        const nodes1 = doc1.getAllNodes();
        const testNode2 = findNodeByTag(nodes1, "test-element-2");
        expect(testNode2).toBeDefined();
        if (testNode2?.kind === "element") {
            expect(testNode2.attrs.testAttr).toBe("fromClient2");
        }
    }, 30000);

    it("should log document load events", async () => {
        // Wait a bit for logs to be captured
        await new Promise((resolve) => setTimeout(resolve, 500));

        const logs = server.getLogs();
        // Room ID is hex-encoded in logs, so just check for LOAD with room=
        const loadLog = logs.find(
            (log) => log.includes("LOAD") && log.includes('room="')
        );
        expect(loadLog).toBeDefined();
    });

    it("should log new room creation", async () => {
        const logs = server.getLogs();
        // Room ID is hex-encoded in logs
        const newRoomLog = logs.find(
            (log) => log.includes("NEW") && log.includes('room="')
        );
        expect(newRoomLog).toBeDefined();
        expect(newRoomLog).toContain("no existing data");
    });

    it("should log sync events", async () => {
        // Wait for save interval to trigger (server has 5s interval)
        await new Promise((resolve) => setTimeout(resolve, 6000));

        const logs = server.getLogs();
        const syncLog = logs.find(
            (log) => log.includes("SYNC") && log.includes('room="')
        );
        expect(syncLog).toBeDefined();
        // Check it includes size info
        expect(syncLog).toMatch(/size=\d/);
    }, 10000);

    it("should log save events", async () => {
        const logs = server.getLogs();
        const saveLog = logs.find(
            (log) => log.includes("SAVED") && log.includes('room="')
        );
        expect(saveLog).toBeDefined();
    });
});

/**
 * Find a node by its tag name
 */
function findNodeByTag(nodes: Record<string, NodeData>, tag: string): NodeData | undefined {
    for (const node of Object.values(nodes)) {
        if (node.kind === "element" && node.tag === tag) {
            return node;
        }
    }
    return undefined;
}

/**
 * Get all node IDs from a document
 */
function getAllNodeIds(doc: DenicekDocument): string[] {
    return Object.keys(doc.getAllNodes());
}

/**
 * Get node count from a document
 */
function getNodeCount(doc: DenicekDocument): number {
    return Object.keys(doc.getAllNodes()).length;
}

/**
 * Wait for two documents to sync by comparing node counts and IDs
 * Note: We don't compare root IDs because when two independently created documents
 * sync, they can have multiple roots with different ordering.
 */
async function waitForSync(
    doc1: DenicekDocument,
    doc2: DenicekDocument,
    timeoutMs = 5000
): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        // Compare all node IDs (sorted) - this is the definitive sync check
        const ids1 = getAllNodeIds(doc1).sort();
        const ids2 = getAllNodeIds(doc2).sort();
        const sameIds = JSON.stringify(ids1) === JSON.stringify(ids2);

        // Also check node count as a sanity check
        const sameCount = getNodeCount(doc1) === getNodeCount(doc2);

        if (sameCount && sameIds && ids1.length > 0) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Documents did not sync within ${timeoutMs}ms`);
}
