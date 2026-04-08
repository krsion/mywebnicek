import { Text } from "@fluentui/react-components";
import type { PlainRecord } from "@mydenicek/react";
import { useDenicek } from "@mydenicek/react";
import { useEffect } from "react";

import { CommandBar } from "./CommandBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeDocument } from "./initializeDocument";
import { RenderedDocument } from "./RenderedDocument.tsx";

function isRec(v: unknown): v is PlainRecord {
  return typeof v === "object" && v !== null && "$tag" in (v as Record<string, unknown>) && !("$items" in (v as Record<string, unknown>)) && !("$ref" in (v as Record<string, unknown>));
}

export function App() {
  const dk = useDenicek();

  // Initialize with sample document on first load
  useEffect(() => {
    // Check fresh materialized tree (not stale dk.doc from render)
    const tree = dk.denicek.materialize();
    if (!isRec(tree) || !("root" in tree)) {
      initializeDocument(dk.denicek);
      dk.forceUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
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
        <Text size={400} weight="semibold" style={{ color: "#242424" }}>mywebnicek</Text>
      </div>

      {/* Main area — rendered document */}
      <div style={{ flex: 1, overflow: "auto", background: "#fff", padding: 24, minHeight: 0 }}>
        <ErrorBoundary>
          <RenderedDocument doc={dk.doc} />
        </ErrorBoundary>
      </div>

      {/* Bottom command bar */}
      <ErrorBoundary>
        <CommandBar dk={dk} />
      </ErrorBoundary>
    </div>
  );
}
