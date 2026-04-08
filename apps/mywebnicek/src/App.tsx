import { Badge, Spinner, Text } from "@fluentui/react-components";
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

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getRoomIdFromHash(): string {
  const hash = window.location.hash.slice(1);
  return hash || generateRoomId();
}

const PEER_NAME_STORAGE_KEY = "mydenicek-peer-name";

export const App = () => {
  const { document, version } = useDocumentState();
  const { connect, status, latency, error } = useConnectivity();
  const [roomId] = useState<string>(() => getRoomIdFromHash());

  const peerId = useMemo(() => document.getPeerId(), [document]);
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const initialNames = document.getPeerNames();
    setPeerNames(initialNames);
    const unsubscribe = document.onPeerNamesChange((names) => setPeerNames(names));
    const savedName = localStorage.getItem(PEER_NAME_STORAGE_KEY);
    if (savedName) document.setPeerName(savedName);
    return unsubscribe;
  }, [document]);

  useEffect(() => {
    if (roomId && window.location.hash.slice(1) !== roomId) {
      window.history.replaceState(null, "", `#${roomId}`);
    }
  }, [roomId]);

  useEffect(() => {
    connect(config.syncServerUrl, roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasInitialized = useRef(false);

  // Initialize document on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    if (!document.getRootId()) {
      initializeDocument(document);
    }
  }, [document]);

  const denicek = useMemo(() => document.denicekInstance, [document]);

  return (
    <PeerAliasProvider selfPeerId={peerId} knownPeerIds={[]} peerNames={peerNames}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Header bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          background: "#f5f5f5",
          borderBottom: "1px solid #e0e0e0",
          flexShrink: 0,
        }}>
          <Text size={400} weight="semibold" style={{ color: "#242424" }}>MyDenicek</Text>
          <SyncStatusIndicator status={status} latency={latency} error={error} />
          <span style={{ color: "#616161", fontFamily: "Consolas, monospace", fontSize: 11, marginLeft: "auto" }}>
            {roomId}
          </span>
        </div>

        {/* Main area — rendered document */}
        <div style={{ flex: 1, overflow: "auto", background: "#fff", padding: 24, minHeight: 0 }}>
          <ErrorBoundary>
            <RenderedDocument document={document} />
          </ErrorBoundary>
        </div>

        {/* Bottom command bar */}
        <ErrorBoundary>
          <CommandBar denicek={denicek} version={version} />
        </ErrorBoundary>
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

