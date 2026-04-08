import { Badge, Spinner } from "@fluentui/react-components";
import {
  useConnectivity,
  useDocumentState,
} from "@mydenicek/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CommandBar } from "./CommandBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { config } from "./config";
import { PeerAliasProvider } from "./context/PeerAliasContext";
import { initializeDocument } from "./initializeDocument";
import { RenderedDocument } from "./RenderedDocument.tsx";

// Generate a random room ID
function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Get room ID from URL hash or generate a new one
function getRoomIdFromHash(): string {
  const hash = window.location.hash.slice(1); // Remove the # prefix
  return hash || generateRoomId();
}

// LocalStorage key for peer name
const PEER_NAME_STORAGE_KEY = "mydenicek-peer-name";

export const App = () => {
  const { document, version } = useDocumentState();
  const { connect, status, latency, error } = useConnectivity();
  const [roomId] = useState<string>(() => getRoomIdFromHash());

  // Get peer ID from document
  const peerId = useMemo(() => document.getPeerId(), [document]);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});

  // Load peer names and restore saved name
  useEffect(() => {
    const initialNames = document.getPeerNames();
    setPeerNames(initialNames);
    const unsubscribe = document.onPeerNamesChange((names) => setPeerNames(names));
    const savedName = localStorage.getItem(PEER_NAME_STORAGE_KEY);
    if (savedName) document.setPeerName(savedName);
    return unsubscribe;
  }, [document]);

  // Update URL hash when room ID changes
  useEffect(() => {
    if (roomId && window.location.hash.slice(1) !== roomId) {
      window.history.replaceState(null, "", `#${roomId}`);
    }
  }, [roomId]);

  // Auto-connect on mount
  useEffect(() => {
    connect(config.syncServerUrl, roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track if we've already initialized
  const hasInitialized = useRef(false);
  const hadHashRoomId = useRef(!!window.location.hash.slice(1));

  // Initialize document — immediately if no room in URL, otherwise wait for sync
  useEffect(() => {
    if (hasInitialized.current) return undefined;

    const existingRoot = document.getRootId();
    if (existingRoot) {
      hasInitialized.current = true;
      return undefined;
    }

    if (!hadHashRoomId.current) {
      hasInitialized.current = true;
      initializeDocument(document);
      return undefined;
    }

    const checkAndMaybeInit = () => {
      if (hasInitialized.current) return;
      const rootId = document.getRootId();
      if (rootId) {
        hasInitialized.current = true;
        unsubscribe();
        clearTimeout(initTimeout);
      }
    };

    const unsubscribe = document.subscribe(() => checkAndMaybeInit());

    const initTimeout = setTimeout(() => {
      if (hasInitialized.current) return;
      const rootId = document.getRootId();
      if (!rootId) {
        hasInitialized.current = true;
        initializeDocument(document);
      } else {
        hasInitialized.current = true;
      }
      unsubscribe();
    }, 1000);

    return () => {
      unsubscribe();
      clearTimeout(initTimeout);
    };
  }, [document]);

  // Get the Denicek CRDT instance
  const denicek = useMemo(() => document.denicekInstance, [document]);

  return (
    <PeerAliasProvider selfPeerId={peerId} knownPeerIds={[]} peerNames={peerNames}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Sync status bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          background: "#252526",
          borderBottom: "1px solid #333",
          flexShrink: 0,
        }}>
          <SyncStatusIndicator status={status} latency={latency} error={error} />
          <span style={{ color: "#666", fontFamily: "Consolas, monospace", fontSize: 11 }}>
            room: {roomId}
          </span>
        </div>

        {/* Main content: command bar left, rendered doc right */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Command bar — left panel */}
          <div style={{ width: "50%", minWidth: 400, display: "flex", flexDirection: "column", borderRight: "2px solid #333" }}>
            <ErrorBoundary>
              <CommandBar denicek={denicek} version={version} />
            </ErrorBoundary>
          </div>

          {/* Rendered document — right panel */}
          <div style={{ flex: 1, overflow: "auto", background: "#fff", padding: 16 }}>
            <ErrorBoundary>
              <RenderedDocument document={document} />
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </PeerAliasProvider>
  );
}

/** Sync status indicator component */
function SyncStatusIndicator({
  status,
  latency,
  error,
}: {
  status: "connecting" | "connected" | "disconnected" | "idle";
  latency?: number;
  error?: string | null;
}) {
  if (status === "connecting") {
    return (
      <Badge appearance="outline" color="warning" size="medium" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Spinner size="extra-tiny" />
        Connecting
      </Badge>
    );
  }

  if (status === "connected") {
    return (
      <Badge appearance="filled" color="success" size="medium">
        {latency ? `Synced (${latency}ms)` : "Synced"}
      </Badge>
    );
  }

  if (status === "disconnected") {
    return (
      <Badge appearance="filled" color="danger" size="medium" title={error || "Disconnected"}>
        Disconnected
      </Badge>
    );
  }

  return (
    <Badge appearance="outline" color="informative" size="medium">
      Offline
    </Badge>
  );
}

