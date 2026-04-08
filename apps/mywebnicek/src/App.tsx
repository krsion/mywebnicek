import { Badge, Button, Card, CardHeader, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger, Input, Spinner, Switch, Tag, TagGroup, Text, Toast, Toaster, Toolbar, ToolbarButton, ToolbarDivider, ToolbarGroup, Tooltip, useId, useToastController } from "@fluentui/react-components";
import { AddRegular, ArrowDownRegular, ArrowLeftRegular, ArrowRedoRegular, ArrowRightRegular, ArrowUndoRegular, ArrowUpRegular, CalculatorRegular, CameraRegular, ClipboardPasteRegular, CodeRegular, CopyRegular, DeleteRegular, DismissRegular, EditRegular, InfoRegular, LinkRegular, PersonRegular, PlayRegular, RecordRegular, RenameRegular, StopRegular } from "@fluentui/react-icons";
import type { GeneralizedPatch, Snapshot } from "@mydenicek/core";
import {
  useConnectivity,
  useDocumentState,
  useFormulaViewMode,
  useRecording,
  useSelectedNode,
  useSelection
} from "@mydenicek/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddNodePopoverButton, type NodeKind } from "./AddNodePopoverButton";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NodeId } from "./components/NodeId";
import { ResizablePanel } from "./components/ResizablePanel";
import { config } from "./config";
import { PeerAliasProvider } from "./context/PeerAliasContext";
import { DomNavigator, type DomNavigatorHandle } from "./DomNavigator";
import { ElementDetails } from "./ElementDetails.tsx";
import { FormulaToolbar } from "./FormulaToolbar";
import { useClipboard } from "./hooks/useClipboard";
import { initializeDocument } from "./initializeDocument";
import { JsonView } from "./JsonView.tsx";
import { RecordedScriptView } from "./RecordedScriptView";
import { RenderedDocument } from "./RenderedDocument.tsx";
import { sanitizeTagName, ToolbarPopoverButton, validateTagName } from "./ToolbarPopoverButton";
import { analyzeSelection, applyIdOverrides, extractReferencedIds, generalizeScript, generalizeScriptWithParams } from "./utils/scriptAnalysis";
import { generalizeSelection } from "./utils/selectionUtils";

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
  const recordingObj = useRecording();
  const { history: recordingHistory, clearHistory, replay } = recordingObj;
  const [showHistory, setShowHistory] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [refPickMode, setRefPickMode] = useState<{ parentId: string } | null>(null);

  const { connect, disconnect, status, latency, error } = useConnectivity();
  const { setSelectedNodeIds, remoteSelections } = useSelection();
  const { selectedNodeId, selectedNodeIds, node, details } = useSelectedNode();
  const { mode: formulaViewMode, toggleMode: toggleFormulaViewMode, isFormulaMode } = useFormulaViewMode();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filterPatches, setFilterPatches] = useState(false);
  const [patchesViewMode, setPatchesViewMode] = useState<'table' | 'json'>('table');

  const [roomId] = useState<string>(() => getRoomIdFromHash());

  // Derive connected from status
  const connected = status === "connected";
  const navigatorRef = useRef<DomNavigatorHandle>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const [selectedActionIndices, setSelectedActionIndices] = useState<Set<number>>(new Set());
  const [idOverrides, setIdOverrides] = useState<Map<string, string>>(new Map());

  // Add to Button dialog state
  const [showAddToButtonDialog, setShowAddToButtonDialog] = useState(false);
  const [selectedActionNodeId, setSelectedActionNodeId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cutNodeIds, setCutNodeIds] = useState<string[]>([]);
  // Pinned button ID for viewing actions (stays visible even when navigating to other nodes)
  const [pinnedButtonId, setPinnedButtonId] = useState<string | null>(null);

  // Action param pick mode: when clicking an action button, user selects nodes for each param
  const [actionParamPickMode, setActionParamPickMode] = useState<{
    actions: GeneralizedPatch[];
    paramNames: string[];
    currentIndex: number;
    collectedParams: Record<string, string>;
  } | null>(null);

  // Parameter configuration for "Add to Button" dialog
  const [paramConfig, setParamConfig] = useState<Record<string, { name: string; fixed: boolean }>>({});

  // Peer name state
  const [peerName, setPeerName] = useState<string>(() =>
    localStorage.getItem(PEER_NAME_STORAGE_KEY) || ""
  );
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});

  // Get peer ID from document
  const peerId = useMemo(() => document.getPeerId(), [document]);

  // Load initial peer names and set our name if we have one saved
  useEffect(() => {
    // Load current peer names
    const initialNames = document.getPeerNames();
    setPeerNames(initialNames);

    // Subscribe to peer names changes
    const unsubscribe = document.onPeerNamesChange((names) => {
      setPeerNames(names);
    });

    // Set our name in CRDT AFTER subscription is set up
    const savedName = localStorage.getItem(PEER_NAME_STORAGE_KEY);
    if (savedName) {
      document.setPeerName(savedName);
    }

    return unsubscribe;
  }, [document]);

  // Handler for name edit
  const handlePeerNameChange = useCallback((newName: string) => {
    const trimmed = newName.trim();
    setPeerName(trimmed);
    localStorage.setItem(PEER_NAME_STORAGE_KEY, trimmed);
    if (trimmed) {
      document.setPeerName(trimmed);
    }
  }, [document]);

  /**
   * Convert node kind + content to proper node data structure.
   * This is a "define errors out of existence" pattern - the function always returns valid node data.
   */
  const createNodeData = useCallback((kind: NodeKind, content: string, defaultTarget: string) => {
    switch (kind) {
      case "value": return { kind: "value" as const, value: content };
      case "element": return { kind: "element" as const, tag: content, attrs: {}, children: [] };
      case "formula": return { kind: "formula" as const, operation: content };
      case "ref": return { kind: "ref" as const, target: content };
      case "action": return { kind: "action" as const, label: content, actions: [], params: { target: defaultTarget } };
    }
  }, []);

  // Find all action nodes in document
  const actionNodes = useMemo(() => {
    const nodes: { id: string; label: string; params: Record<string, string> }[] = [];
    const traverse = (id: string) => {
      const node = document.getNode(id);
      if (!node) return;
      if (node.kind === "action") {
        nodes.push({ id, label: node.label, params: node.params });
      }
      if (node.kind === "element") {
        const childIds = document.getChildIds(id);
        for (const childId of childIds) {
          traverse(childId);
        }
      }
    };
    const rootId = document.getRootId();
    if (rootId) traverse(rootId);
    return nodes;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version triggers recalculation when document changes
  }, [document, version]);

  // Toast for share notification
  const toasterId = useId("share-toaster");
  const { dispatchToast } = useToastController(toasterId);

  // Update URL hash when room ID changes
  useEffect(() => {
    if (roomId && window.location.hash.slice(1) !== roomId) {
      window.history.replaceState(null, "", `#${roomId}`);
    }
  }, [roomId]);

  // Keyboard shortcuts for cut/paste move operations
  useEffect(() => {
    const rootId = document.getRootId();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Ctrl+X: Cut selected nodes
      if (e.ctrlKey && e.key === 'x' && selectedNodeIds.length > 0) {
        e.preventDefault();
        // Don't allow cutting root
        const cuttableIds = selectedNodeIds.filter(id => id !== rootId);
        if (cuttableIds.length > 0) {
          setCutNodeIds(cuttableIds);
        }
      }

      // Ctrl+V: Paste cut nodes as children of selected node
      if (e.ctrlKey && e.key === 'v' && cutNodeIds.length > 0 && selectedNodeIds.length === 1) {
        e.preventDefault();
        const targetId = selectedNodeIds[0]!;
        document.moveNodes(cutNodeIds, targetId);
        setCutNodeIds([]);
      }

      // Escape: Cancel cut
      if (e.key === 'Escape' && cutNodeIds.length > 0) {
        setCutNodeIds([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeIds, cutNodeIds, document]);

  // Auto-connect on mount
  useEffect(() => {
    connect(config.syncServerUrl, roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track if we've already initialized
  const hasInitialized = useRef(false);
  // Whether the room ID came from the URL hash (existing session to sync)
  const hadHashRoomId = useRef(!!window.location.hash.slice(1));

  // Initialize document — immediately if no room in URL, otherwise wait for sync
  useEffect(() => {
    if (hasInitialized.current) return undefined;

    // Check immediately if document already has content
    const existingRoot = document.getRootId();
    if (existingRoot) {
      hasInitialized.current = true;
      return undefined;
    }

    // No room ID in URL → fresh session, initialize immediately
    if (!hadHashRoomId.current) {
      hasInitialized.current = true;
      initializeDocument(document);
      return undefined;
    }

    // Room ID from URL → wait for sync to bring data
    const checkAndMaybeInit = () => {
      if (hasInitialized.current) return;

      const rootId = document.getRootId();
      if (rootId) {
        hasInitialized.current = true;
        unsubscribe();
        clearTimeout(initTimeout);
      }
    };

    const unsubscribe = document.subscribe(() => {
      checkAndMaybeInit();
    });

    // Fallback: if sync doesn't bring data within 1 second, initialize
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

  // Handle share button click
  const handleShare = useCallback(() => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#${roomId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      dispatchToast(
        <Toast>Link copied to clipboard!</Toast>,
        { intent: "success" }
      );
    }).catch(() => {
      dispatchToast(
        <Toast>Failed to copy link</Toast>,
        { intent: "error" }
      );
    });
  }, [roomId, dispatchToast]);

  // Handle sync toggle
  const handleSyncToggle = useCallback(() => {
    if (status === "connected" || status === "connecting") {
      disconnect();
    } else {
      connect(config.syncServerUrl, roomId);
    }
  }, [status, connect, disconnect, roomId]);

  // Frontend-only generalization for Shift+click multi-select
  const handleGeneralize = useCallback((ids: string[]) => {
    return generalizeSelection(document, ids);
  }, [document]);

  // Dynamic creation analysis based on current selection
  const createdNodes = useMemo(() => {
    if (!recordingHistory || recordingHistory.length === 0 || selectedActionIndices.size === 0) {
      return new Map();
    }
    return analyzeSelection(recordingHistory, selectedActionIndices);
  }, [recordingHistory, selectedActionIndices]);

  // Scroll history to bottom when new actions are recorded
  useEffect(() => {
    if (historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
    }
  }, [recordingHistory]);

  // Auto-pin when a button is selected
  useEffect(() => {
    if (node?.kind === "action" && selectedNodeId) {
      setPinnedButtonId(selectedNodeId);
    }
  }, [node?.kind, selectedNodeId]);

  // Get the pinned button's node data (may be different from currently selected node)
  const pinnedButtonNode = useMemo(() => {
    if (!pinnedButtonId) return null;
    const node = document.getNode(pinnedButtonId);
    if (!node || node.kind !== "action") return null;
    return node;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version triggers recalculation when document changes
  }, [pinnedButtonId, document, version]);

  const handleReplay = () => {
    if (!recordingHistory || !selectedNodeId) return;

    // Get indices to replay (all or selected)
    const indicesToReplay = selectedActionIndices.size > 0
      ? Array.from(selectedActionIndices).sort((a, b) => a - b)
      : recordingHistory.map((_, i) => i);

    if (indicesToReplay.length === 0) return;

    // Get the actions to replay
    const actionsToReplay = indicesToReplay
      .map(i => recordingHistory[i])
      .filter((action): action is NonNullable<typeof action> => action !== null);

    if (actionsToReplay.length === 0) return;

    // Apply global ID overrides (user retargeting)
    const overridden = applyIdOverrides(actionsToReplay, idOverrides);
    // Generalize: created nodes → $1, $2, etc.
    const generalized = generalizeScript(overridden);
    replay(generalized, { target: selectedNodeId });
  };

  const handleActionSelectionChange = useCallback((indices: Set<number>) => {
    setSelectedActionIndices(indices);
  }, []);

  const handleClearHistory = useCallback(() => {
    clearHistory();
    setSelectedActionIndices(new Set());
    setIdOverrides(new Map());
  }, [clearHistory]);

  const handleRetarget = useCallback((originalId: string, newNodeId: string) => {
    setIdOverrides(prev => {
      const newMap = new Map(prev);
      newMap.set(originalId, newNodeId);
      return newMap;
    });
  }, []);

  // Get actions to add (with overrides applied) - used by dialog
  const actionsToAdd = useMemo(() => {
    if (!recordingHistory || selectedActionIndices.size === 0) return [];
    const indicesToUse = Array.from(selectedActionIndices).sort((a, b) => a - b);
    const actionsToUse = indicesToUse
      .map(i => recordingHistory[i])
      .filter((action): action is NonNullable<typeof action> => action !== null);
    return applyIdOverrides(actionsToUse, idOverrides);
  }, [recordingHistory, selectedActionIndices, idOverrides]);

  // Extract referenced IDs from selected actions (for param config dialog)
  const extractedIds = useMemo(() => {
    if (!showAddToButtonDialog || actionsToAdd.length === 0) return [];
    return extractReferencedIds(actionsToAdd);
  }, [showAddToButtonDialog, actionsToAdd]);

  // Initialize param config when dialog opens or IDs change
  useEffect(() => {
    if (showAddToButtonDialog && extractedIds.length > 0) {
      const newConfig: Record<string, { name: string; fixed: boolean }> = {};
      extractedIds.forEach((id, index) => {
        // Preserve existing config if available, otherwise create default
        if (paramConfig[id]) {
          newConfig[id] = paramConfig[id];
        } else {
          newConfig[id] = { name: `param${index}`, fixed: false };
        }
      });
      setParamConfig(newConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddToButtonDialog, extractedIds.join(",")]);

  // Add selected actions to an existing action node
  const handleAddToButton = useCallback(() => {
    if (actionsToAdd.length === 0 || !selectedActionNodeId) return;

    // Build params from config (only non-fixed entries become params)
    const params: Record<string, string> = {};
    for (const [nodeId, config] of Object.entries(paramConfig)) {
      if (!config.fixed && config.name.trim()) {
        params[config.name.trim()] = nodeId;
      }
    }

    // Generalize: replace param IDs with $name, created nodes with $1, $2, etc.
    const generalized = generalizeScriptWithParams(actionsToAdd, params);

    // Update the button's params and append actions
    document.updateNodeProperty(selectedActionNodeId, "params", params);
    document.appendActions(selectedActionNodeId, generalized);

    setShowAddToButtonDialog(false);
    setSelectedActionNodeId(null);
    setParamConfig({});
  }, [actionsToAdd, paramConfig, document, selectedActionNodeId]);

  // Handler for action button clicks - enters param pick mode if there are params to bind
  const handleActionClick = useCallback((actions: GeneralizedPatch[], paramNames: string[]) => {
    if (paramNames.length === 0) {
      // No params to bind - execute immediately
      replay(actions, {});
    } else {
      // Enter param pick mode
      setActionParamPickMode({
        actions,
        paramNames,
        currentIndex: 0,
        collectedParams: {},
      });
    }
  }, [replay]);

  // Handler for move up/down buttons
  const handleMoveInSiblings = useCallback((direction: -1 | 1) => {
    if (selectedNodeIds.length !== 1) return;
    const nodeId = selectedNodeIds[0]!;
    const rootId = document.getRootId();
    if (nodeId === rootId) return;

    const parentId = document.getParentId(nodeId);
    if (!parentId) return;

    const siblings = document.getChildIds(parentId);
    const currentIndex = siblings.indexOf(nodeId);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= siblings.length) return;

    document.moveNodes([nodeId], parentId, newIndex);

    // Re-focus on the moved node to update the selection overlay
    clickOnSelectedNode(nodeId);
  }, [selectedNodeIds, document]);

  const triggerNavigation = (action: 'parent' | 'child' | 'prev' | 'next' | 'clear') => {
    if (!navigatorRef.current) return;
    switch (action) {
      case 'parent':
        navigatorRef.current.navigateToParent();
        break;
      case 'child':
        navigatorRef.current.navigateToFirstChild();
        break;
      case 'prev':
        navigatorRef.current.navigateToPrevSibling();
        break;
      case 'next':
        navigatorRef.current.navigateToNextSibling();
        break;
      case 'clear':
        navigatorRef.current.clearSelection();
        break;
    }
  };

  const handleAttributeChange = (key: string, value: unknown | undefined) => {
    if (selectedNodeIds.length === 0) return;
    document.updateAttribute(selectedNodeIds, key, value);
  };

  // Clipboard: copy creates a "copy" action referencing the source node
  const { canPaste, isValueSelected, handleCopy, handlePaste } = useClipboard({
    selectedNodeId: selectedNodeId ?? null,
    node,
    document,
  });

  // Get first child's tag for the selected element node
  const selectedNodeFirstChildTag = (() => {
    if (!node || node.kind !== "element" || !selectedNodeId) return undefined;
    const childIds = document.getChildIds(selectedNodeId);
    if (childIds.length === 0) return undefined;
    const firstChild = document.getNode(childIds[0]!);
    return firstChild?.kind === "element" ? firstChild.tag : undefined;
  })();
  const selectedNodeAttributes = (node && node.kind === "element") ? node.attrs : undefined;

  // Collect known peer IDs from recording history and remote selections
  const knownPeerIds = useMemo(() => {
    const peerIds = new Set<string>();

    const extractPeerId = (id: string) => {
      const match = id.match(/^\d+@(\d+)$/);
      if (match?.[1]) peerIds.add(match[1]);
    };

    // Extract peer IDs from recording history
    if (recordingHistory) {
      for (const patch of recordingHistory) {
        extractPeerId(patch.target);
        if (patch.type === "tree" && (patch.action === "create" || patch.action === "move")) {
          extractPeerId(patch.parent);
        }
        if (patch.type === "tree" && patch.action === "create" && patch.sourceId) {
          extractPeerId(patch.sourceId);
        }
      }
    }

    // Add remote selection peer IDs
    if (remoteSelections) {
      for (const peerId of Object.keys(remoteSelections)) {
        peerIds.add(peerId);
      }
    }

    return Array.from(peerIds);
  }, [recordingHistory, remoteSelections]);

  return (
    <PeerAliasProvider selfPeerId={peerId} knownPeerIds={knownPeerIds} peerNames={peerNames}>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <Toaster toasterId={toasterId} position="bottom-end" />
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <Card appearance="subtle" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Toolbar style={{ display: "flex", flexWrap: "wrap", gap: "4px", justifyContent: "space-between" }}>
              <ToolbarGroup>
                <Tooltip content="Undo" relationship="label">
                  <ToolbarButton
                    icon={<ArrowUndoRegular />}
                    onClick={() => {
                      document.undo();
                      if (selectedNodeId) clickOnSelectedNode(selectedNodeId);
                    }}
                    disabled={!document.canUndo}
                  />
                </Tooltip>
                <Tooltip content="Redo" relationship="label">
                  <ToolbarButton
                    icon={<ArrowRedoRegular />}
                    onClick={() => {
                      document.redo();
                      if (selectedNodeId) clickOnSelectedNode(selectedNodeId);
                    }}
                    disabled={!document.canRedo}
                  />
                </Tooltip>
                <ToolbarDivider />
                <AddNodePopoverButton
                  disabled={!node || (node.kind !== "element" && node.kind !== "formula" && node.kind !== "value")}
                  canAddChild={node?.kind === "element" || node?.kind === "formula"}
                  initialValue={selectedNodeFirstChildTag || ""}
                  onAddChild={(content, kind) => {
                    if (!selectedNodeId) return;
                    const [newId] = document.addChildren(selectedNodeId, [createNodeData(kind, content, selectedNodeId)]);
                    if (newId) setSelectedNodeIds([newId]);
                  }}
                  onStartRefPick={() => {
                    if (selectedNodeId) {
                      setRefPickMode({ parentId: selectedNodeId });
                    }
                  }}
                />

                {node?.kind === "value" ? (
                  <ToolbarPopoverButton
                    text="Edit"
                    icon={<EditRegular />}
                    disabled={false}
                    ariaLabel="Edit"
                    placeholder="Value content"
                    initialValue={String(details?.value ?? "")}
                    preserveWhitespace
                    onSubmit={(value) => {
                      const originalValue = String(details?.value ?? "");
                      document.updateValue(selectedNodeIds, originalValue, value);
                    }}
                  />
                ) : (
                  <ToolbarPopoverButton
                    text="Rename"
                    icon={<RenameRegular />}
                    disabled={!selectedNodeId || node?.kind !== "element"}
                    ariaLabel="Rename"
                    placeholder="Tag name (e.g. div)"
                    initialValue={details?.tag || details?.dom?.tagName || ""}
                    validate={validateTagName}
                    onSubmit={(value) => {
                      const { tag } = sanitizeTagName(value);
                      if (tag) {
                        document.updateTag(selectedNodeIds, tag);
                        if (selectedNodeId) clickOnSelectedNode(selectedNodeId);
                      }
                    }}
                  />
                )}
                <FormulaToolbar document={document} selectedNodeId={selectedNodeId} node={node} />

                <Tooltip content="Copy (Ctrl+C)" relationship="label">
                  <ToolbarButton
                    icon={<CopyRegular />}
                    disabled={!isValueSelected}
                    onClick={handleCopy}
                  />
                </Tooltip>

                <Tooltip content="Paste (Ctrl+V)" relationship="label">
                  <ToolbarButton
                    icon={<ClipboardPasteRegular />}
                    onClick={handlePaste}
                    disabled={!canPaste}
                  />
                </Tooltip>

                <Tooltip content="Delete selected nodes" relationship="label">
                  <ToolbarButton
                    icon={<DeleteRegular />}
                    disabled={selectedNodeIds.length === 0 || selectedNodeIds.includes(document.getRootId() ?? "")}
                    onClick={() => setShowDeleteConfirm(true)}
                  />
                </Tooltip>

                <ToolbarDivider />

                <Tooltip content={isFormulaMode ? "Showing formula structure" : "Showing formula results"} relationship="label">
                  <ToolbarButton
                    icon={<CalculatorRegular />}
                    onClick={toggleFormulaViewMode}
                    appearance={isFormulaMode ? "primary" : "subtle"}
                  >
                    {isFormulaMode ? "Formulas" : "Results"}
                  </ToolbarButton>
                </Tooltip>
              </ToolbarGroup>

              <ToolbarGroup>
                <ToolbarPopoverButton
                  text="Edit your display name"
                  icon={<PersonRegular />}
                  disabled={false}
                  ariaLabel="Edit name"
                  placeholder="Your name"
                  initialValue={peerName}
                  onSubmit={handlePeerNameChange}
                >
                  {peerName || "Anonymous"}
                </ToolbarPopoverButton>
                <SyncStatusIndicator status={status} latency={latency} error={error} />
                <Switch
                  checked={status === "connected" || status === "connecting"}
                  onChange={handleSyncToggle}
                  label={connected ? "Sync on" : "Sync off"}
                />
                <Tooltip content="Copy shareable link" relationship="label">
                  <ToolbarButton
                    icon={<LinkRegular />}
                    onClick={handleShare}
                  >
                    Share
                  </ToolbarButton>
                </Tooltip>
                <Dialog>
                  <DialogTrigger>
                    <ToolbarButton icon={<CodeRegular />}>Raw</ToolbarButton>
                  </DialogTrigger>
                  <DialogSurface style={{ width: 1000 }}>
                    <DialogBody>
                      <DialogContent>
                        <JsonView data={document} />
                      </DialogContent>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
                <ToolbarButton icon={<CameraRegular />} onClick={() => setSnapshot(document.getSnapshot())}>Snapshot</ToolbarButton>
                <ToolbarDivider />
                {showDetails ? (
                  <ToolbarButton icon={<InfoRegular />} onClick={() => setShowDetails(!showDetails)} appearance="primary">Details</ToolbarButton>
                ) : (
                  <ToolbarButton icon={<InfoRegular />} onClick={() => setShowDetails(!showDetails)}>Details</ToolbarButton>
                )}
                {showHistory ? (
                  <ToolbarButton icon={<RecordRegular />} onClick={() => setShowHistory(!showHistory)} appearance="primary">Actions</ToolbarButton>
                ) : (
                  <ToolbarButton icon={<RecordRegular />} onClick={() => setShowHistory(!showHistory)}>Actions</ToolbarButton>
                )}
              </ToolbarGroup>
            </Toolbar>

            <CardHeader header={<TagGroup>
              <Tag icon={<ArrowUpRegular />} onClick={() => triggerNavigation('parent')} style={{ cursor: 'pointer' }}> Parent</Tag>
              <Tag icon={<ArrowDownRegular />} onClick={() => triggerNavigation('child')} style={{ cursor: 'pointer' }}> First child</Tag>
              <Tag icon={<ArrowLeftRegular />} onClick={() => triggerNavigation('prev')} style={{ cursor: 'pointer' }}> Prev sibling</Tag>
              <Tag icon={<ArrowRightRegular />} onClick={() => triggerNavigation('next')} style={{ cursor: 'pointer' }}> Next sibling</Tag>
              <Tag icon={<Text>Esc</Text>} onClick={() => triggerNavigation('clear')} style={{ cursor: 'pointer' }}>Clear</Tag>
              <Text style={{ margin: '0 8px', color: '#666' }}>|</Text>
              <Tag icon={<ArrowUpRegular />} onClick={() => handleMoveInSiblings(-1)} style={{ cursor: 'pointer', background: '#e3f2fd' }}> Move ↑</Tag>
              <Tag icon={<ArrowDownRegular />} onClick={() => handleMoveInSiblings(1)} style={{ cursor: 'pointer', background: '#e3f2fd' }}> Move ↓</Tag>
            </TagGroup>}
            />

            <div style={{ flex: 1, overflow: "auto", minHeight: 0, position: "relative" }}>
              {refPickMode && (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  padding: "8px 12px",
                  background: "#fff3cd",
                  borderBottom: "1px solid #ffc107",
                  zIndex: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <Text>Click on a node to create a reference to it</Text>
                  <Button size="small" onClick={() => setRefPickMode(null)}>Cancel</Button>
                </div>
              )}
              {cutNodeIds.length > 0 && (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  padding: "8px 12px",
                  background: "#e3f2fd",
                  borderBottom: "1px solid #2196f3",
                  zIndex: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <Text>{cutNodeIds.length} node{cutNodeIds.length !== 1 ? "s" : ""} cut. Select target and press Ctrl+V to paste.</Text>
                  <Button size="small" onClick={() => setCutNodeIds([])}>Cancel</Button>
                </div>
              )}
              {actionParamPickMode && (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  padding: "8px 12px",
                  background: "#fff3cd",
                  borderBottom: "1px solid #ffc107",
                  zIndex: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <Text>
                    Click a node to set as <strong>${actionParamPickMode.paramNames[actionParamPickMode.currentIndex]}</strong>
                    {actionParamPickMode.paramNames.length > 1 && (
                      <span style={{ marginLeft: 8, opacity: 0.7 }}>
                        ({actionParamPickMode.currentIndex + 1} of {actionParamPickMode.paramNames.length})
                      </span>
                    )}
                  </Text>
                  <Button size="small" onClick={() => setActionParamPickMode(null)}>Cancel</Button>
                </div>
              )}
              <DomNavigator ref={navigatorRef} onSelectedChange={(ids) => {
                const targetId = ids[0];
                if (refPickMode && targetId) {
                  const { parentId } = refPickMode;
                  document.addChildren(parentId, [{ kind: "ref", target: targetId }]);
                  setRefPickMode(null);
                  return;
                }
                if (actionParamPickMode && targetId) {
                  const { actions, paramNames, currentIndex, collectedParams } = actionParamPickMode;
                  const paramName = paramNames[currentIndex];
                  if (paramName) {
                    const newParams = { ...collectedParams, [paramName]: targetId };

                    if (currentIndex + 1 < paramNames.length) {
                      // More params to select
                      setActionParamPickMode({
                        ...actionParamPickMode,
                        currentIndex: currentIndex + 1,
                        collectedParams: newParams,
                      });
                    } else {
                      // All params collected → execute replay
                      replay(actions, newParams);
                      setActionParamPickMode(null);
                    }
                  }
                  return;
                }
                setSelectedNodeIds(ids);
              }} selectedNodeIds={selectedNodeIds} remoteSelections={remoteSelections} generalizer={handleGeneralize}>
                <ErrorBoundary>
                  <RenderedDocument document={document} onActionClick={handleActionClick} viewMode={formulaViewMode} onRefClick={(targetId) => setSelectedNodeIds([targetId])} cutNodeIds={cutNodeIds} />
                </ErrorBoundary>
              </DomNavigator>
            </div>

            {showDetails && (
              <ElementDetails
                details={details}
                attributes={selectedNodeAttributes}
                onAttributeChange={handleAttributeChange}
                onIdClick={(id) => setSelectedNodeIds([id])}
              />
            )}

            {snapshot && (
              <Card>
                <CardHeader header={<Text>Patches from Snapshot</Text>} action={<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Switch label="Filter by selection" checked={filterPatches} onChange={(_, data) => setFilterPatches(data.checked)} />
                  <ToolbarButton icon={<CodeRegular />} onClick={() => setPatchesViewMode(patchesViewMode === 'table' ? 'json' : 'table')}>
                    {patchesViewMode === 'table' ? 'JSON' : 'Table'}
                  </ToolbarButton>
                  <ToolbarButton icon={<CameraRegular />} onClick={() => setSnapshot(null)}>Clear</ToolbarButton>
                </div>} />
              </Card>
            )}
          </Card>
        </div>
        <ResizablePanel open={showHistory} defaultWidth={700} minWidth={200} maxWidth={1200}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Show action node details when one is pinned */}
            {pinnedButtonNode && (
              <div style={{ borderBottom: '2px solid #0078d4', background: '#f0f6ff' }}>
                <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div
                      style={{ cursor: 'pointer' }}
                      onClick={() => pinnedButtonId && setSelectedNodeIds([pinnedButtonId])}
                      title="Click to select this button"
                    >
                      <Text weight="semibold" style={{ color: '#0078d4' }}>Button: {pinnedButtonNode.label}</Text>
                    </div>
                    {Object.keys(pinnedButtonNode.params).length > 0 && (
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        Params: {Object.entries(pinnedButtonNode.params).map(([name, id]) => (
                          <span key={name} style={{ marginRight: 8 }}>
                            ${name}=<NodeId id={id} onClick={(nodeId) => setSelectedNodeIds([nodeId])} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Badge appearance="filled" color="brand">{pinnedButtonNode.actions.length} action{pinnedButtonNode.actions.length !== 1 ? 's' : ''}</Badge>
                    <Tooltip content="Close" relationship="label">
                      <ToolbarButton
                        icon={<DismissRegular />}
                        appearance="subtle"
                        onClick={() => setPinnedButtonId(null)}
                      />
                    </Tooltip>
                  </div>
                </div>
                {pinnedButtonNode.actions.length > 0 && (
                  <div style={{ maxHeight: 200, overflow: 'auto', padding: '0 8px 8px' }}>
                    <RecordedScriptView
                      script={pinnedButtonNode.actions}
                      onNodeClick={(id) => setSelectedNodeIds([id])}
                      selectedIndices={new Set()}
                      onSelectionChange={() => { }}
                      currentNodeId={selectedNodeId ?? null}
                      mode="view"
                      actionParams={pinnedButtonNode.params}
                      onDeleteAction={(index) => {
                        if (pinnedButtonId) {
                          document.deleteAction(pinnedButtonId, index);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: '12px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <Text weight="semibold">Recorded History</Text>
              <ToolbarButton
                appearance="subtle"
                icon={<StopRegular />}
                onClick={handleClearHistory}
                aria-label="Clear Actions"
              />
            </div>
            <div ref={historyScrollRef} style={{ flex: 1, overflow: 'auto', padding: '8px', minHeight: 0 }}>
              <RecordedScriptView
                script={recordingHistory || []}
                onNodeClick={(id) => setSelectedNodeIds([id])}
                selectedIndices={selectedActionIndices}
                onSelectionChange={handleActionSelectionChange}
                idOverrides={idOverrides}
                onRetarget={handleRetarget}
                currentNodeId={selectedNodeId ?? null}
                createdNodes={createdNodes}
              />
            </div>
            <div style={{ padding: '12px', borderTop: '1px solid #e0e0e0', display: 'flex', gap: '8px' }}>
              <Tooltip content="Apply selected actions to the currently selected node" relationship="label">
                <Button
                  icon={<PlayRegular />}
                  onClick={handleReplay}
                  disabled={!recordingHistory?.length || !selectedNodeId}
                  appearance="primary"
                  style={{ flex: 1 }}
                >
                  {selectedActionIndices.size > 0 ? `Apply (${selectedActionIndices.size})` : "Apply all"}
                </Button>
              </Tooltip>
              <Tooltip content="Add selected actions to an existing action button" relationship="label">
                <Button
                  icon={<AddRegular />}
                  onClick={() => setShowAddToButtonDialog(true)}
                  disabled={!recordingHistory?.length || selectedActionIndices.size === 0 || actionNodes.length === 0}
                  appearance="secondary"
                >
                  Add to Button
                </Button>
              </Tooltip>
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={showDeleteConfirm} onOpenChange={(_, data) => setShowDeleteConfirm(data.open)}>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Delete {selectedNodeIds.length} node{selectedNodeIds.length !== 1 ? "s" : ""}?</DialogTitle>
                  <DialogContent>
                    This action can be undone with Ctrl+Z.
                  </DialogContent>
                  <DialogActions>
                    <Button appearance="secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                    <Button appearance="primary" onClick={() => {
                      document.deleteNodes(selectedNodeIds);
                      setShowDeleteConfirm(false);
                    }}>Delete</Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>

            {/* Add to Button Dialog */}
            <Dialog open={showAddToButtonDialog} onOpenChange={(_, data) => {
              setShowAddToButtonDialog(data.open);
              if (!data.open) {
                setSelectedActionNodeId(null);
                setParamConfig({});
              }
            }}>
              <DialogSurface style={{ maxWidth: 600 }}>
                <DialogBody>
                  <DialogTitle>Add Actions to Button</DialogTitle>
                  <DialogContent>
                    <Text size={200} style={{ marginBottom: 12, display: 'block' }}>
                      Select a button to add {selectedActionIndices.size} action{selectedActionIndices.size !== 1 ? 's' : ''} to:
                    </Text>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {actionNodes.map(({ id, label, params }) => (
                        <Button
                          key={id}
                          appearance={selectedActionNodeId === id ? 'primary' : 'secondary'}
                          onClick={() => setSelectedActionNodeId(id)}
                          style={{ justifyContent: 'flex-start' }}
                        >
                          <span style={{ fontWeight: 'bold' }}>{label}</span>
                          <span style={{ marginLeft: 8, opacity: 0.7, fontSize: '0.9em' }}>
                            {Object.entries(params).map(([name, nodeId]) => `$${name}=${nodeId}`).join(", ")}
                          </span>
                        </Button>
                      ))}
                      {actionNodes.length === 0 && (
                        <Text size={200} style={{ color: '#666' }}>
                          No action buttons found. Create one first using the toolbar.
                        </Text>
                      )}
                    </div>

                    {/* Parameter Configuration */}
                    {extractedIds.length > 0 && (
                      <>
                        <Text weight="semibold" size={300} style={{ marginBottom: 8, display: 'block' }}>
                          Configure Parameters
                        </Text>
                        <Text size={200} style={{ marginBottom: 12, display: 'block', color: '#666' }}>
                          For each referenced node, name it to make it a parameter or mark as fixed:
                        </Text>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {extractedIds.map((nodeId) => {
                            const config = paramConfig[nodeId] || { name: '', fixed: false };
                            return (
                              <div key={nodeId} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px',
                                background: config.fixed ? '#f5f5f5' : '#e8f4e8',
                                borderRadius: 4,
                              }}>
                                <Checkbox
                                  checked={config.fixed}
                                  onChange={(_, data) => {
                                    setParamConfig(prev => ({
                                      ...prev,
                                      [nodeId]: { ...config, fixed: !!data.checked }
                                    }));
                                  }}
                                  label="Fixed"
                                />
                                <Input
                                  size="small"
                                  placeholder="param name"
                                  value={config.name}
                                  disabled={config.fixed}
                                  onChange={(_, data) => {
                                    setParamConfig(prev => ({
                                      ...prev,
                                      [nodeId]: { ...config, name: data.value }
                                    }));
                                  }}
                                  style={{ width: 120 }}
                                />
                                <NodeId id={nodeId} onClick={(id) => setSelectedNodeIds([id])} />
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary">Cancel</Button>
                    </DialogTrigger>
                    <Button
                      appearance="primary"
                      onClick={handleAddToButton}
                      disabled={!selectedActionNodeId}
                    >
                      Add
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </div>
        </ResizablePanel>
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
      <Tooltip content="Attempting to connect..." relationship="label">
        <Badge appearance="outline" color="warning" size="medium" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Spinner size="extra-tiny" />
          Connecting
        </Badge>
      </Tooltip>
    );
  }

  if (status === "connected") {
    return (
      <Tooltip
        content={latency ? `Round-trip latency: ${latency}ms` : "Connected to sync server"}
        relationship="label"
      >
        <Badge appearance="filled" color="success" size="medium">
          {latency ? `Synced (${latency}ms)` : "Synced"}
        </Badge>
      </Tooltip>
    );
  }

  if (status === "disconnected") {
    return (
      <Tooltip content={error || "Connection lost, will auto-retry"} relationship="label">
        <Badge appearance="filled" color="danger" size="medium">
          Disconnected
        </Badge>
      </Tooltip>
    );
  }

  // idle
  return (
    <Badge appearance="outline" color="informative" size="medium">
      Offline
    </Badge>
  );
}

function clickOnSelectedNode(selectedNodeGuid: string) {
  setTimeout(() => {
    const el = document.querySelector(`[data-node-guid='${selectedNodeGuid}']`) as HTMLElement | null;
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, 0);
}


