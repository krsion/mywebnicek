/**
 * Formula-specific toolbar controls
 *
 * A deep module that encapsulates all formula-related toolbar UI:
 * - Wrap in formula (when value/ref/formula selected)
 * - Edit operation (when formula selected)
 * - Argument hints (when formula selected)
 */

import { Combobox, Option, Text } from "@fluentui/react-components";
import type { DenicekDocument, NodeData } from "@mydenicek/core";

import { builtinOperationNames, defaultOperationsMap } from "./formula";

interface FormulaToolbarProps {
    document: DenicekDocument;
    selectedNodeId: string | null | undefined;
    node: NodeData | null | undefined;
}

/**
 * Get operation info for display
 */
function getOperationInfo(operationName: string) {
    const op = defaultOperationsMap.get(operationName);
    const arity = op?.arity ?? 0;
    return {
        arityText: arity === -1 ? "variadic" : `${arity} args`,
        expectedArity: arity,
    };
}

export function FormulaToolbar({ document, selectedNodeId, node }: FormulaToolbarProps) {
    if (!selectedNodeId) return null;

    return (
        <>
            {/* Formula Operation Editor + Arity Hints */}
            {node?.kind === "formula" && (
                <FormulaOperationEditor
                    document={document}
                    selectedNodeId={selectedNodeId}
                    operation={node.operation}
                />
            )}
        </>
    );
}

/**
 * Combobox to edit formula operation + arity hint
 */
function FormulaOperationEditor({ document, selectedNodeId, operation }: {
    document: DenicekDocument;
    selectedNodeId: string;
    operation: string;
}) {
    const { expectedArity } = getOperationInfo(operation);
    const actualArity = document.getChildIds(selectedNodeId).length;
    const isRpn = actualArity === 0;

    // For RPN (childless) formulas, show "RPN" instead of child arity
    const arityDisplay = isRpn
        ? (expectedArity === -1 ? "RPN variadic" : `RPN (${expectedArity} args)`)
        : (expectedArity === -1 ? `${actualArity}/∞` : `${actualArity}/${expectedArity}`);
    const isValidArity = isRpn || expectedArity === -1 || actualArity === expectedArity;

    return (
        <>
            <Combobox
                placeholder="Operation"
                value={operation}
                style={{ minWidth: 120 }}
                onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                        document.updateFormulaOperation(selectedNodeId, data.optionValue!);
                    }
                }}
            >
                {builtinOperationNames.map((name) => (
                    <Option key={name} value={name}>{name}</Option>
                ))}
            </Combobox>
            <Text
                size={200}
                style={{
                    color: isValidArity ? "#666" : "#d13438",
                    alignSelf: "center",
                    marginLeft: 4
                }}
            >
                {arityDisplay}
            </Text>
        </>
    );
}
