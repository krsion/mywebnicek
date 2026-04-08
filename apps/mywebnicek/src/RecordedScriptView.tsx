import { Badge, Button, Card, CardHeader, Checkbox, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Tooltip } from "@fluentui/react-components";
import { DeleteRegular, TargetRegular } from "@fluentui/react-icons";
import { type GeneralizedPatch } from "@mydenicek/document";

import { NodeId } from "./components/NodeId";
import { usePeerAlias } from "./context/PeerAliasContext";
import type { CreatedNodeInfo } from "./utils/scriptAnalysis";

// Check if a string is a variable placeholder ($0, $1, etc.)
function isVariablePlaceholder(id: string): boolean {
    return id.startsWith("$");
}

/** Get variable name from placeholder (e.g., "$wrapper" -> "wrapper", "$1" -> "1") */
function getVariableName(id: string): string | null {
    if (!id.startsWith("$")) return null;
    return id.slice(1);
}

/** Check if variable is a numeric created-node placeholder ($1, $2, etc.) */
function isNumericVariable(id: string): boolean {
    return /^\$\d+$/.test(id);
}

interface RecordedScriptViewProps {
    script: GeneralizedPatch[];
    onNodeClick?: (id: string) => void;
    selectedIndices?: Set<number>;
    onSelectionChange?: (indices: Set<number>) => void;
    /** Global ID overrides: originalId → newId */
    idOverrides?: Map<string, string>;
    /** Retarget a concrete ID globally (all references update) */
    onRetarget?: (originalId: string, newNodeId: string) => void;
    currentNodeId?: string | null;
    /** Dynamic creation analysis based on current selection */
    createdNodes?: Map<string, CreatedNodeInfo>;
    /** Mode: "history" shows selection checkboxes, "view" shows delete buttons */
    mode?: "history" | "view";
    /** Callback when delete button is clicked in view mode */
    onDeleteAction?: (index: number) => void;
    /** Named params for placeholder resolution (used when viewing button actions) */
    actionParams?: Record<string, string>;
}

export function RecordedScriptView({ script, onNodeClick, selectedIndices, onSelectionChange, idOverrides, onRetarget, currentNodeId, createdNodes, mode = "history", onDeleteAction, actionParams }: RecordedScriptViewProps) {
    const { formatValue } = usePeerAlias();
    const hasSelection = selectedIndices !== undefined && onSelectionChange !== undefined;
    const allSelected = hasSelection && script.length > 0 && selectedIndices.size === script.length;
    const someSelected = hasSelection && selectedIndices.size > 0 && selectedIndices.size < script.length;

    const handleToggle = (index: number) => {
        if (!onSelectionChange || !selectedIndices) return;
        const newSet = new Set(selectedIndices);
        if (newSet.has(index)) {
            newSet.delete(index);
        } else {
            newSet.add(index);
        }
        onSelectionChange(newSet);
    };

    const handleSelectAll = () => {
        if (!onSelectionChange) return;
        if (allSelected) {
            onSelectionChange(new Set());
        } else {
            onSelectionChange(new Set(script.map((_, i) => i)));
        }
    };

    const handleClearSelection = () => {
        if (!onSelectionChange) return;
        onSelectionChange(new Set());
    };

    const isViewMode = mode === "view";

    if (!script || script.length === 0) {
        return (
            <Card>
                {!isViewMode && <CardHeader header={<Text>Recorded Actions</Text>} />}
                <Text style={{ padding: 12, fontStyle: 'italic', color: '#666' }}>
                    {isViewMode ? 'No actions assigned to this button.' : 'No actions recorded yet. Perform actions on the document to record them.'}
                </Text>
            </Card>
        );
    }

    return (
        <Card style={{ overflow: 'hidden' }}>
            {!isViewMode && (
                <CardHeader
                    header={<Text>Recorded Actions</Text>}
                    action={hasSelection ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <Button size="small" appearance="subtle" onClick={handleSelectAll}>
                                {allSelected ? 'Deselect all' : 'Select all'}
                            </Button>
                            {someSelected && (
                                <Button size="small" appearance="subtle" onClick={handleClearSelection}>
                                    Clear
                                </Button>
                            )}
                        </div>
                    ) : null}
                />
            )}
            <div style={{ overflowX: 'auto', overflowY: 'auto' }}>
                <Table size="small">
                    <TableHeader>
                        <TableRow>
                            {hasSelection && !isViewMode && (
                                <TableHeaderCell style={{ width: '32px' }}>
                                    <Checkbox
                                        checked={allSelected ? true : someSelected ? 'mixed' : false}
                                        onChange={handleSelectAll}
                                    />
                                </TableHeaderCell>
                            )}
                            {isViewMode && onDeleteAction && (
                                <TableHeaderCell style={{ width: '32px' }}></TableHeaderCell>
                            )}
                            <TableHeaderCell>Details</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {script.map((patch, i) => {
                            const isSelected = hasSelection && selectedIndices.has(i);

                            // Render a node reference — either a concrete ID or a variable placeholder
                            function renderNodeRef(nodeId: string): React.ReactNode {
                                // In view mode, handle variable placeholders from stored button actions
                                if (isViewMode) {
                                    const varName = getVariableName(nodeId);
                                    if (varName !== null) {
                                        // Check if this is a named param that we can resolve
                                        const resolvedId = actionParams?.[varName];
                                        if (resolvedId) {
                                            return <NodeId id={resolvedId} onClick={onNodeClick} />;
                                        }
                                        // Numeric variables ($1, $2, etc.) are created during replay
                                        if (isNumericVariable(nodeId)) {
                                            return <Badge appearance="outline" color="success" size="small">#{varName}</Badge>;
                                        }
                                        // Named param without resolution - show as badge
                                        return <Badge appearance="outline" color="informative" size="small">${varName}</Badge>;
                                    }
                                }

                                // History mode: show concrete IDs with optional override + retarget
                                const displayId = idOverrides?.get(nodeId) ?? nodeId;
                                const isOverridden = idOverrides?.has(nodeId) ?? false;
                                const creation = createdNodes?.get(displayId);

                                return (
                                    <>
                                        <span style={isOverridden ? { backgroundColor: 'rgba(34, 197, 94, 0.2)', borderRadius: '3px' } : undefined}>
                                            <NodeId id={displayId} onClick={onNodeClick} />
                                        </span>
                                        {creation && (
                                            <Badge appearance="outline" color="success" size="small" style={{ marginLeft: 2 }}>#{creation.number}</Badge>
                                        )}
                                        {onRetarget && !isViewMode && currentNodeId && !isVariablePlaceholder(nodeId) && (
                                            <Tooltip content="Use selected node as target" relationship="label">
                                                <Button
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={<TargetRegular />}
                                                    onClick={() => onRetarget(nodeId, currentNodeId)}
                                                    disabled={displayId === currentNodeId}
                                                    style={{ minWidth: 'auto', padding: '2px' }}
                                                />
                                            </Tooltip>
                                        )}
                                    </>
                                );
                            }

                            function renderActionSentence(): React.ReactNode {
                                if (patch.type === "tree") {
                                    if (patch.action === "create") {
                                        // Create with sourceId: "copy SOURCE to PARENT"
                                        if (patch.sourceId) {
                                            return (
                                                <>
                                                    <span style={{ color: '#0078d4' }}>copy</span>
                                                    {renderNodeRef(patch.sourceId)}
                                                    <span>to</span>
                                                    {renderNodeRef(patch.parent)}
                                                </>
                                            );
                                        }

                                        // Create with inline data: "create <tag> in PARENT"
                                        if (patch.data) {
                                            let nodeDisplay = '';
                                            if (patch.data.kind === 'element') {
                                                const tag = patch.data.tag;
                                                const attrs = patch.data.attrs ?? {};
                                                const attrStr = Object.entries(attrs)
                                                    .slice(0, 2)
                                                    .map(([k, v]) => `${k}="${String(v).slice(0, 10)}"`)
                                                    .join(' ');
                                                nodeDisplay = `<${tag}${attrStr ? ' ' + attrStr : ''}></${tag}>`;
                                            } else if (patch.data.kind === 'value') {
                                                const text = patch.data.value;
                                                nodeDisplay = `"${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`;
                                            } else if (patch.data.kind === 'ref') {
                                                nodeDisplay = `ref(${patch.data.target})`;
                                            } else if (patch.data.kind === 'formula') {
                                                nodeDisplay = `formula(${patch.data.operation})`;
                                            }

                                            return (
                                                <>
                                                    <span style={{ color: '#0078d4' }}>create</span>
                                                    <span style={{ color: '#666' }}>{nodeDisplay}</span>
                                                    <span>in</span>
                                                    {renderNodeRef(patch.parent)}
                                                </>
                                            );
                                        }

                                        // Create without sourceId or data: plain create in parent
                                        return (
                                            <>
                                                <span style={{ color: '#0078d4' }}>create</span>
                                                <span>in</span>
                                                {renderNodeRef(patch.parent)}
                                            </>
                                        );
                                    }

                                    if (patch.action === "delete") {
                                        return (
                                            <>
                                                <span style={{ color: '#0078d4' }}>delete</span>
                                                {renderNodeRef(patch.target)}
                                            </>
                                        );
                                    }

                                    if (patch.action === "move") {
                                        return (
                                            <>
                                                <span style={{ color: '#0078d4' }}>move</span>
                                                {renderNodeRef(patch.target)}
                                                <span>to</span>
                                                {renderNodeRef(patch.parent)}
                                                <span style={{ color: '#888' }}>at index {patch.index}</span>
                                            </>
                                        );
                                    }
                                }

                                if (patch.type === "map") {
                                    return (
                                        <>
                                            <span style={{ color: '#0078d4' }}>set</span>
                                            <span style={{ color: '#666' }}>{patch.key} = {JSON.stringify(formatValue(patch.value)).slice(0, 30)}</span>
                                            <span>on</span>
                                            {renderNodeRef(patch.target)}
                                        </>
                                    );
                                }

                                if (patch.type === "text") {
                                    const insertDisplay = patch.insert
                                        ? `"${patch.insert.slice(0, 20)}${patch.insert.length > 20 ? '...' : ''}"`
                                        : '""';
                                    return (
                                        <>
                                            <span style={{ color: '#0078d4' }}>splice</span>
                                            <span style={{ color: '#888' }}>pos:{patch.index}</span>
                                            <span style={{ color: '#888' }}>del:{patch.delete}</span>
                                            <span style={{ color: '#666' }}>{insertDisplay}</span>
                                            <span>on</span>
                                            {renderNodeRef(patch.target)}
                                        </>
                                    );
                                }

                                // Exhaustive check - should never reach here
                                return <span style={{ color: '#888' }}>unknown patch</span>;
                            }

                            return (
                                <TableRow
                                    key={i}
                                    style={isSelected ? { background: 'rgba(59, 130, 246, 0.1)' } : undefined}
                                >
                                    {hasSelection && !isViewMode && (
                                        <TableCell>
                                            <Checkbox
                                                checked={isSelected}
                                                onChange={() => handleToggle(i)}
                                            />
                                        </TableCell>
                                    )}
                                    {isViewMode && onDeleteAction && (
                                        <TableCell>
                                            <Tooltip content="Remove this action" relationship="label">
                                                <Button
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={<DeleteRegular />}
                                                    onClick={() => onDeleteAction(i)}
                                                    style={{ minWidth: 'auto', padding: '2px', color: '#d13438' }}
                                                />
                                            </Tooltip>
                                        </TableCell>
                                    )}
                                    <TableCell style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                            {renderActionSentence()}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </Card>
    );
}
