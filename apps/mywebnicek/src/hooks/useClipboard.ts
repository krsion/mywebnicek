/**
 * Hook for clipboard operations between nodes.
 *
 * Copies create a "copy" action in history that references the source node.
 * On replay, the copy reads the CURRENT value from the source.
 *
 * Input elements expose their child value node's ID via data-node-guid,
 * so selecting an input auto-redirects to the value child. No special
 * input handling needed here — value nodes are copied directly.
 */

import type { DenicekDocument, NodeData } from "@mydenicek/core";
import { useCallback, useEffect, useState } from "react";

interface ClipboardData {
    sourceNodeId: string;
    /** For display only */
    textValue: string;
}

interface UseClipboardProps {
    selectedNodeId: string | null;
    node: NodeData | null | undefined;
    document: DenicekDocument;
}

export function useClipboard({ selectedNodeId, node, document: doc }: UseClipboardProps) {
    const [clipboard, setClipboard] = useState<ClipboardData | null>(null);

    const isValueSelected = node?.kind === "value";

    const handleCopy = useCallback(() => {
        if (!selectedNodeId || !isValueSelected) return;

        const valueNode = doc.getNode(selectedNodeId);
        if (valueNode?.kind === "value") {
            setClipboard({ sourceNodeId: selectedNodeId, textValue: String(valueNode.value) });
        }
    }, [selectedNodeId, isValueSelected, doc]);

    const isElementSelected = node?.kind === "element";

    const handlePaste = useCallback(() => {
        if (!selectedNodeId || !clipboard) return;

        if (isValueSelected) {
            const parentId = doc.getParentId(selectedNodeId);
            if (!parentId) return;
            doc.copyNode(clipboard.sourceNodeId, parentId);
        } else if (isElementSelected) {
            doc.copyNode(clipboard.sourceNodeId, selectedNodeId);
        }
    }, [selectedNodeId, isValueSelected, isElementSelected, clipboard, doc]);

    const canPaste = clipboard !== null && (isValueSelected || isElementSelected);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "c" && isValueSelected) {
                e.preventDefault();
                handleCopy();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "v" && canPaste) {
                e.preventDefault();
                handlePaste();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isValueSelected, canPaste, handleCopy, handlePaste]);

    return {
        isValueSelected,
        isElementSelected,
        handleCopy,
        handlePaste,
        canPaste,
    };
}
