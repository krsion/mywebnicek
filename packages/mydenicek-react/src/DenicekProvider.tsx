/**
 * DenicekProvider - React context provider for Loro-based documents
 *
 * This provider creates and manages a DenicekDocument,
 * making it available to child components via React context.
 */

import {
    DenicekDocument,
    type SyncState,
} from "@mydenicek/core";
import { createContext, type ReactNode, useEffect, useMemo, useState } from "react";

// Context types
export interface DenicekContextValue {
    /** The document instance (includes undo/redo, history, replay, and node access) */
    document: DenicekDocument;
    /** Version counter - changes on each document update, use for reactive dependencies */
    version: number;
    /** Sync manager */
    syncManager?: {
        connect: (url: string, roomId: string) => Promise<void>;
        disconnect: () => Promise<void>;
        /** Current sync state with status, latency, error */
        syncState: SyncState;
    };
}

export interface DenicekSelectionContextValue {
    /** Currently selected node IDs */
    selectedNodeIds: string[];
    /** Update selection */
    setSelectedNodeIds: (ids: string[]) => void;
}

// Contexts
export const DenicekContext = createContext<DenicekContextValue | null>(null);
export const DenicekSelectionContext = createContext<DenicekSelectionContextValue | null>(null);

export interface DenicekProviderProps {
    children: ReactNode;
    /** Optional initial document (for importing existing data) */
    initialDocument?: DenicekDocument;
    /** Optional initializer to set up document structure when creating a new document */
    initializer?: (doc: DenicekDocument) => void;
    /** Callback when document changes */
    onChange?: () => void;
    /** Optional peer ID for CRDT operations (should be persisted across sessions) */
    peerId?: string;
}

/**
 * Provider component for Denicek documents
 */
export function DenicekProvider({
    children,
    initialDocument,
    initializer,
    onChange,
    peerId,
}: DenicekProviderProps) {
    // Version counter for triggering re-renders
    const [version, setVersion] = useState(0);

    // Create or use provided document
    const document = useMemo(() => {
        return initialDocument ?? DenicekDocument.create(
            { onVersionChange: () => setVersion(v => v + 1), peerId },
            initializer
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDocument]);

    // If using an external document, subscribe to its changes
    useEffect(() => {
        if (initialDocument) {
            return initialDocument.subscribe(() => {
                setVersion(v => v + 1);
            });
        }
        return undefined;
    }, [initialDocument]);

    // Sync state tracking
    const [syncState, setSyncState] = useState<SyncState>(() => document.getSyncState());

    // Subscribe to sync state changes
    useEffect(() => {
        return document.onSyncStateChange(setSyncState);
    }, [document]);

    // Notify parent of changes
    useEffect(() => {
        onChange?.();
    }, [version, onChange]);

    // Sync handlers - use document's built-in sync methods
    const connect = async (url: string, roomId: string) => {
        try {
            await document.connectToSync({ url, roomId });
        } catch (error) {
            // Error is already captured in syncState via onSyncStateChange
            console.error("Sync connection failed:", error);
        }
    };

    const disconnect = async () => {
        await document.disconnectSync();
    };

    // Selection state
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    const contextValue: DenicekContextValue = {
        document,
        version,
        syncManager: {
            connect,
            disconnect,
            syncState,
        }
    };

    const selectionContextValue: DenicekSelectionContextValue = {
        selectedNodeIds,
        setSelectedNodeIds,
    };

    return (
        <DenicekSelectionContext.Provider value={selectionContextValue}>
            <DenicekContext.Provider value={contextValue}>
                {children}
            </DenicekContext.Provider>
        </DenicekSelectionContext.Provider>
    );
}
