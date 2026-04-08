/**
 * Hook for managing selection state
 */

import type { NodeData } from "@mydenicek/core";
import { useContext, useMemo } from "react";

import { DENICEK_NODE_ID_ATTR } from "./constants.js";
import { DenicekContext, DenicekSelectionContext } from "./DenicekProvider.js";

export interface SelectedNodeDetails {
    id: string;
    node: NodeData | undefined;
    tag: string | undefined;
    value: string | number | undefined;  // Supports both strings and numbers for formulas
    attrs: Record<string, unknown> | undefined;
    dom?: {
        tagName: string;
        classes: string[];
        width: number;
        height: number;
        rect: DOMRect;
    };
}

/**
 * Hook to access and update selection
 */
export function useSelection() {
    const context = useContext(DenicekSelectionContext);
    if (!context) {
        throw new Error("useSelection must be used within a DenicekProvider");
    }
    return {
        selectedNodeIds: context.selectedNodeIds,
        setSelectedNodeIds: context.setSelectedNodeIds,
        // For backwards compatibility (no remote sync in v2 yet)
        remoteSelections: {} as Record<string, string[] | null>,
        userId: null as string | null,
        clearSelection: () => context.setSelectedNodeIds([]),
        selectNode: (id: string) => context.setSelectedNodeIds([id]),
        toggleNode: (id: string) => {
            const current = context.selectedNodeIds;
            if (current.includes(id)) {
                context.setSelectedNodeIds(current.filter(x => x !== id));
            } else {
                context.setSelectedNodeIds([...current, id]);
            }
        },
    };
}

/**
 * Hook to get details about the selected node(s)
 */
export function useSelectedNode() {
    const context = useContext(DenicekContext);
    const selectionContext = useContext(DenicekSelectionContext);

    if (!context || !selectionContext) {
        throw new Error("useSelectedNode must be used within a DenicekProvider");
    }

    const { document: denicekDoc, version } = context;
    const { selectedNodeIds } = selectionContext;

    const selectedNodeId = selectedNodeIds.length > 0
        ? selectedNodeIds[selectedNodeIds.length - 1]
        : undefined;

    const node = useMemo(() => {
        if (!selectedNodeId) return undefined;
        return denicekDoc.getNode(selectedNodeId) ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [denicekDoc, version, selectedNodeId]);

    const details = useMemo<SelectedNodeDetails | undefined>(() => {
        if (!selectedNodeId) return undefined;

        // Attempt to find the element in the DOM for visual info
        const el = document.querySelector(`[${DENICEK_NODE_ID_ATTR}="${selectedNodeId}"]`) as HTMLElement | null;

        const baseInfo: SelectedNodeDetails = {
            id: selectedNodeId,
            node: node,
            tag: node?.kind === "element" ? node.tag : undefined,
            value: node?.kind === "value" ? node.value : undefined,
            attrs: node?.kind === "element" ? node.attrs : undefined,
        };

        if (el) {
            const rect = el.getBoundingClientRect();
            return {
                ...baseInfo,
                dom: {
                    tagName: el.tagName.toLowerCase(),
                    classes: Array.from(el.classList),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    rect,
                }
            };
        }

        return baseInfo;
    }, [node, selectedNodeId]);

    return {
        selectedNodeId,
        selectedNodeIds,
        node,
        details,
    };
}
