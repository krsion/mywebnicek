/**
 * React hooks for Denicek document operations
 */

import {
    type GeneralizedPatch,
    type SyncStatus,
} from "@mydenicek/document";
import { useContext, useEffect, useState } from "react";

import { DenicekContext } from "./DenicekProvider.js";


/**
 * Hook to access document state.
 * Returns the document instance which provides direct access to nodes via
 * getNode(), getChildIds(), getParentId(), getRootId().
 */
export function useDocumentState() {
    const context = useContext(DenicekContext);
    if (!context) {
        throw new Error("useDocumentState must be used within a DenicekProvider");
    }

    return {
        document: context.document,
        version: context.version,
    };
}

const defaultSyncState = {
    status: "idle" as SyncStatus,
    latency: undefined as number | undefined,
    roomId: null as string | null,
    error: null as string | null,
};

/**
 * Hook for sync connectivity state
 * Provides reactive access to sync status, latency, and error information
 */
export function useConnectivity() {
    const context = useContext(DenicekContext);
    if (!context) {
        throw new Error("useConnectivity must be used within a DenicekProvider");
    }

    const syncState = context.syncManager?.syncState ?? defaultSyncState;

    return {
        connect: (url: string, roomId: string) => {
            if (context.syncManager) {
                context.syncManager.connect(url, roomId).catch(console.error);
            }
        },
        disconnect: () => {
            context.syncManager?.disconnect();
        },
        // New reactive state
        status: syncState.status,
        latency: syncState.latency,
        error: syncState.error,
        roomId: syncState.roomId,
        // Backwards compatible
        isConnected: syncState.status === "connected",
    };
}

/**
 * Hook for recording
 * Provides access to document change history for replay functionality
 */
export function useRecording() {
    const context = useContext(DenicekContext);
    if (!context) {
        throw new Error("useRecording must be used within a DenicekProvider");
    }
    const { document, version } = context;

    // Derive history from Loro diffs - refreshes on every version change
    const [historyData, setHistoryData] = useState<GeneralizedPatch[]>(() => document.getHistory());

    useEffect(() => {
        setHistoryData(document.getHistory());
    }, [document, version]);

    return {
        replay: (script: GeneralizedPatch[], params: Record<string, string>) => document.replay(script, params),
        history: historyData,
        clearHistory: () => {
            document.clearHistory();
            setHistoryData([]);
        },
    };
}


