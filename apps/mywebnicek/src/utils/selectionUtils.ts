/**
 * Selection utilities for the frontend
 *
 * This is a frontend-only implementation of selection generalization.
 * It works with DenicekDocument for encapsulated tree access.
 */

import type { DenicekDocument } from "@mydenicek/core";

/**
 * Find the lowest common ancestor of a set of nodes
 */
function findLowestCommonAncestor(
    doc: DenicekDocument,
    nodeIds: string[]
): string | null {
    if (nodeIds.length === 0) return null;

    // O(1) parent lookup via DenicekDocument
    const getParentId = (nodeId: string) => doc.getParentId(nodeId);

    let currentLca: string | null = nodeIds[0] ?? null;

    for (let i = 1; i < nodeIds.length; i++) {
        if (!currentLca) break;
        const nextNode = nodeIds[i];

        // Get ancestors of current LCA
        const ancestors = new Set<string>();
        let curr: string | null = currentLca;
        while (curr) {
            ancestors.add(curr);
            curr = getParentId(curr);
        }

        // Find first ancestor of nextNode that's in ancestors set
        let runner: string | null = nextNode ?? null;
        let found = false;
        while (runner) {
            if (ancestors.has(runner)) {
                currentLca = runner;
                found = true;
                break;
            }
            runner = getParentId(runner);
        }
        if (!found) {
            currentLca = doc.getRootId();
        }
    }

    return currentLca;
}

/**
 * Generalize a selection to find all matching nodes
 *
 * Given a set of selected nodes, finds all nodes that match the same pattern
 * (same tag, same depth from LCA, same kind).
 */
export function generalizeSelection(
    doc: DenicekDocument,
    nodeIds: string[]
): string[] {
    if (nodeIds.length === 0) return [];

    // O(1) parent lookup via DenicekDocument
    const getParentId = (nodeId: string) => doc.getParentId(nodeId);

    let lcaId = findLowestCommonAncestor(doc, nodeIds);
    if (!lcaId) return [];

    // When a single node is selected, use its parent as LCA
    if (nodeIds.length === 1) {
        const parentId = getParentId(lcaId);
        if (parentId) lcaId = parentId;
    }

    const getDepthFromLca = (nodeId: string): number => {
        let depth = 0;
        let current: string | null = nodeId;
        while (current && current !== lcaId) {
            depth++;
            current = getParentId(current);
        }
        return current === lcaId ? depth : -1;
    };

    // Analyze selected nodes
    const selectedTags = new Set<string>();
    const selectedDepths = new Set<number>();
    let hasValues = false;
    let hasElements = false;

    for (const id of nodeIds) {
        const node = doc.getNode(id);
        if (!node) continue;

        const depth = getDepthFromLca(id);
        if (depth >= 0) selectedDepths.add(depth);

        if (node.kind === "element") {
            selectedTags.add(node.tag);
            hasElements = true;
        } else if (node.kind === "value") {
            hasValues = true;
        }
    }

    const allSameTag = selectedTags.size === 1 && !hasValues;
    const allSameDepth = selectedDepths.size === 1;

    const selectorKind: "element" | "value" | undefined =
        (hasValues && !hasElements) ? "value" :
        (hasElements && !hasValues) ? "element" :
        undefined;

    // If no common pattern, return original selection
    if (!allSameTag && !allSameDepth) {
        return [...nodeIds];
    }

    const selectorTag = allSameTag ? [...selectedTags][0] : undefined;
    const selectorDepth = allSameDepth ? [...selectedDepths][0] : undefined;

    // Find all matching nodes
    const results: string[] = [];

    const traverse = (currentId: string, currentDepth: number) => {
        const node = doc.getNode(currentId);
        if (!node) return;

        if (node.kind === "element") {
            const tagMatches = selectorTag === undefined || node.tag === selectorTag;
            const depthMatches = selectorDepth === undefined || currentDepth === selectorDepth;
            const kindMatches = selectorKind === undefined || selectorKind === "element";

            if (tagMatches && depthMatches && kindMatches && currentDepth > 0) {
                results.push(currentId);
            }

            // Use getChildIds instead of node.children
            for (const childId of doc.getChildIds(currentId)) {
                traverse(childId, currentDepth + 1);
            }
        } else if (node.kind === "value") {
            const depthMatches = selectorDepth === undefined || currentDepth === selectorDepth;
            const kindMatches = selectorKind === undefined || selectorKind === "value";
            if (depthMatches && kindMatches && currentDepth > 0) {
                results.push(currentId);
            }
        }
    };

    traverse(lcaId, 0);
    return results;
}
