import { makeStyles, mergeClasses } from "@fluentui/react-components";
import { type DenicekDocument, evaluateFormula, type GeneralizedPatch, getNodeValue, isFormulaError, type Operation } from "@mydenicek/core";
import { DENICEK_NODE_ID_ATTR, type FormulaViewMode } from "@mydenicek/react";
import React from "react";

import { defaultOperationsMap } from "./formula";
import { useDebouncedCallback } from "./hooks/useDebounce";

const useStyles = makeStyles({
  article: {
    padding: "12px",
    background: "#fff",
    borderRadius: "8px",
    border: "1px solid #ddd",
  },
  button: {
    padding: "6px 12px",
    cursor: "pointer",
  },
  ul: {
    padding: "0 0 0 20px",
  },
  li: {
    margin: "4px 0",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
  },
  th: {
    border: "1px solid #ddd",
    padding: "8px",
    backgroundColor: "#f2f2f2",
    textAlign: "left",
  },
  td: {
    border: "1px solid #ddd",
    padding: "8px",
  },
  tr: {
    "&:nth-child(even)": {
      backgroundColor: "#f9f9f9",
    },
  },
  formula: {
    display: "inline-block",
    backgroundColor: "#e8f4e8",
    padding: "2px 6px",
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: "0.9em",
  },
  formulaError: {
    backgroundColor: "#ffe8e8",
    color: "#c00",
  },
  formulaStructure: {
    backgroundColor: "#f0f0ff",
    border: "1px dashed #aaf",
  },
  ref: {
    display: "inline-block",
    backgroundColor: "#fff8e0",
    padding: "2px 6px",
    borderRadius: "4px",
    fontStyle: "italic",
  },
  refTarget: {
    color: "#666",
    fontSize: "0.8em",
  },
});


/**
 * Determines which child indices are "consumed" by childless RPN formulas.
 * In result mode, consumed children are hidden — only the formula result is shown.
 */
function getConsumedChildIndices(
  childIds: string[],
  doc: DenicekDocument,
  opsMap: Map<string, Operation>
): Set<number> {
  const consumed = new Set<number>();
  const stack: number[] = []; // stack of child indices

  for (let i = 0; i < childIds.length; i++) {
    const childId = childIds[i]!;
    const node = doc.getNode(childId);
    if (!node) continue;

    if (node.kind === "formula" && doc.getChildIds(childId).length === 0) {
      const op = opsMap.get(node.operation);
      if (op) {
        const popCount = op.arity === -1 ? stack.length : op.arity;
        for (let j = 0; j < popCount && stack.length > 0; j++) {
          consumed.add(stack.pop()!);
        }
      }
      stack.push(i);
    } else {
      stack.push(i);
    }
  }

  return consumed;
}

interface RenderedDocumentProps {
  document: DenicekDocument;
  /** Called when an action button is clicked. Receives actions and param names to be bound. */
  onActionClick?: (actions: GeneralizedPatch[], paramNames: string[]) => void;
  /** View mode for formulas: "result" shows computed values, "formula" shows structure */
  viewMode?: FormulaViewMode;
  /** Custom operations map. If not provided, uses defaultOperationsMap */
  operations?: Map<string, Operation>;
  /** Callback when a ref link is clicked */
  onRefClick?: (targetId: string) => void;
  /** Node IDs that are currently cut (will be styled with dimmed appearance) */
  cutNodeIds?: string[];
}

export function RenderedDocument({ document, onActionClick, viewMode = "result", operations, onRefClick, cutNodeIds = [] }: RenderedDocumentProps) {
  const styles = useStyles();

  // Use provided operations or default ones
  const opsMap = React.useMemo(() => operations ?? defaultOperationsMap, [operations]);

  // Create formula context for evaluation
  const formulaContext = React.useMemo(() => ({
    operations: opsMap,
    document: {
      getNode: (id: string) => document.getNode(id) ?? undefined,
      getChildIds: (id: string) => document.getChildIds(id),
      getParentId: (id: string) => document.getParentId(id),
    },
  }), [opsMap, document]);

  // Sync input value to child value node's LoroText (debounced to avoid lag while typing)
  const updateInputValue = React.useCallback((inputNodeId: string, newValue: string) => {
    const childIds = document.getChildIds(inputNodeId);
    const valueChildId = childIds.find(cid => document.getNode(cid)?.kind === "value");
    if (!valueChildId) return;
    const valueNode = document.getNode(valueChildId);
    const currentValue = valueNode?.kind === "value" ? String(valueNode.value) : "";
    document.updateValue([valueChildId], currentValue, newValue);
  }, [document]);

  const debouncedUpdateInputValue = useDebouncedCallback(updateInputValue, 150);

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>, nodeId: string) => {
    const value = e.currentTarget.value;
    debouncedUpdateInputValue(nodeId, value);
  }, [debouncedUpdateInputValue]);

  // Handler for action button clicks
  const handleActionClick = React.useCallback((nodeId: string) => {
    const node = document.getNode(nodeId);
    if (!node || node.kind !== "action") return;

    const { actions, params } = node;
    if (!actions.length) return;

    const paramNames = Object.keys(params);

    if (onActionClick) {
      onActionClick(actions, paramNames);
    } else {
      // Fallback: replay directly on the document (no params to bind)
      if (paramNames.length === 0) {
        document.replay(actions, {});
      }
    }
  }, [document, onActionClick]);

  function renderById(id: string): React.ReactNode {
    const node = document.getNode(id);
    if (!node) return undefined;

    if (node.kind === "value") {
      return React.createElement('x-value', { [DENICEK_NODE_ID_ATTR]: id }, node.value);
    }

    // Handle ref nodes
    if (node.kind === "ref") {
      const targetNode = document.getNode(node.target);
      const value = getNodeValue(node.target, formulaContext);
      const displayValue = isFormulaError(value) ? value : String(value ?? "");
      const targetLabel = targetNode?.kind === "value" ? `"${displayValue}"` :
        targetNode?.kind === "formula" ? `ƒ ${(targetNode as { operation: string }).operation}` :
          targetNode?.kind === "element" ? `<${(targetNode as { tag: string }).tag}>` :
            node.target.slice(0, 8);

      if (viewMode === "formula") {
        // Show the reference structure with clickable link
        return React.createElement(
          'x-ref',
          {
            [DENICEK_NODE_ID_ATTR]: id,
            className: styles.ref,
          },
          "→ ",
          React.createElement(
            'a',
            {
              href: "#",
              className: styles.refTarget,
              style: { cursor: 'pointer', textDecoration: 'underline' },
              onClick: (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                onRefClick?.(node.target);
              },
            },
            targetLabel
          )
        );
      } else {
        // Show the resolved value with clickable indicator
        return React.createElement(
          'x-ref',
          {
            [DENICEK_NODE_ID_ATTR]: id,
            className: mergeClasses(styles.ref, isFormulaError(value) ? styles.formulaError : undefined),
            title: `Click to go to: ${targetLabel}`,
            style: { cursor: 'pointer' },
            onClick: (e: React.MouseEvent) => {
              if (e.ctrlKey || e.metaKey) {
                e.stopPropagation();
                onRefClick?.(node.target);
              }
            },
          },
          displayValue,
          React.createElement(
            'span',
            {
              style: { fontSize: '0.7em', opacity: 0.6, marginLeft: 4 },
            },
            "↗"
          )
        );
      }
    }

    // Handle formula nodes
    if (node.kind === "formula") {
      const formulaChildIds = document.getChildIds(id);

      if (viewMode === "formula") {
        if (formulaChildIds.length === 0) {
          // RPN formula (childless): show as operation badge
          return React.createElement(
            'x-formula',
            {
              [DENICEK_NODE_ID_ATTR]: id,
              className: mergeClasses(styles.formula, styles.formulaStructure),
            },
            node.operation
          );
        }

        // Child-based formula: show operation(arg1, arg2, ...)
        const childElements = formulaChildIds.map((childId, idx) => {
          const rendered = renderById(childId);
          return React.createElement(
            'span',
            { key: childId },
            idx > 0 ? ", " : "",
            rendered
          );
        });

        return React.createElement(
          'x-formula',
          {
            [DENICEK_NODE_ID_ATTR]: id,
            className: mergeClasses(styles.formula, styles.formulaStructure),
          },
          `${node.operation}(`,
          ...childElements,
          ")"
        );
      } else {
        // Result mode: evaluateFormula handles both child-based and RPN
        const result = evaluateFormula(id, formulaContext);
        const displayValue = isFormulaError(result) ? result : String(result ?? "");
        return React.createElement(
          'x-formula',
          {
            [DENICEK_NODE_ID_ATTR]: id,
            className: mergeClasses(styles.formula, isFormulaError(result) ? styles.formulaError : undefined),
            title: `Formula: ${node.operation}`,
          },
          displayValue
        );
      }
    }

    // Handle action nodes - render as buttons
    if (node.kind === "action") {
      const paramNames = Object.keys(node.params);
      const paramsTitle = paramNames.length > 0
        ? `Params: ${paramNames.map(n => `$${n}`).join(", ")}`
        : "No params";
      return React.createElement(
        'button',
        {
          [DENICEK_NODE_ID_ATTR]: id,
          className: styles.button,
          onClick: (e: React.MouseEvent) => {
            // Allow Ctrl+click/Shift+click for selection (don't execute)
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              return; // Let event bubble for selection
            }
            e.stopPropagation();  // Don't trigger selection on regular click
            handleActionClick(id);
          },
          title: paramsTitle,
        },
        node.label
      );
    }

    const attrs = { ...(node.attrs || {}), [DENICEK_NODE_ID_ATTR]: id } as Record<string, unknown>;

    // Apply cut styling if this node is in the cut list
    const isCut = cutNodeIds.includes(id);

    const classNames = [];
    if (node.tag === "article") classNames.push(styles.article);
    if (node.tag === "button") classNames.push(styles.button);
    if (node.tag === "ul") classNames.push(styles.ul);
    if (node.tag === "li") classNames.push(styles.li);
    if (node.tag === "table") classNames.push(styles.table);
    if (node.tag === "th") classNames.push(styles.th);
    if (node.tag === "td") classNames.push(styles.td);
    if (node.tag === "tr") classNames.push(styles.tr);

    if (attrs["className"] && typeof attrs["className"] === "string") {
      classNames.push(attrs["className"]);
    }
    if (classNames.length > 0) attrs["className"] = mergeClasses(...classNames);

    if (attrs["style"] && typeof attrs["style"] === "string") {
      try {
        attrs["style"] = JSON.parse(attrs["style"]);
      } catch {
        // If style is a string but not valid JSON, we remove it to avoid React warnings
        // about style being a string.
        delete attrs["style"];
      }
    }

    // Apply cut node styling (dimmed with dashed border)
    if (isCut) {
      const existingStyle = (attrs["style"] as React.CSSProperties) || {};
      attrs["style"] = {
        ...existingStyle,
        opacity: 0.5,
        borderStyle: "dashed",
        borderWidth: existingStyle.borderWidth || "1px",
        borderColor: existingStyle.borderColor || "#999",
      };
    }

    const childIds = document.getChildIds(id);

    // Input elements: expose child value node's ID for auto-redirect selection,
    // and sync DOM input value to the child LoroText on change
    if (node.tag === "input") {
      const valueChildId = childIds.find(cid => document.getNode(cid)?.kind === "value");
      if (valueChildId) {
        attrs[DENICEK_NODE_ID_ATTR] = valueChildId;
      }
      attrs["onChange"] = (e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(e, id);
    }
    // Void elements (input, img, etc.) can't have DOM children
    const isVoidElement = node.tag === "input" || node.tag === "img" || node.tag === "br" || node.tag === "hr";
    const renderedChildren: React.ReactNode[] = [];
    if (!isVoidElement) {
      // In result mode, hide children consumed by RPN formulas
      const consumed = viewMode === "result" ? getConsumedChildIndices(childIds, document, opsMap) : new Set<number>();

      for (let childIdx = 0; childIdx < childIds.length; childIdx++) {
        if (consumed.has(childIdx)) continue;
        const childId = childIds[childIdx]!;
        const rendered = renderById(childId);
        if (React.isValidElement(rendered)) {
          renderedChildren.push(React.cloneElement(rendered as React.ReactElement<unknown>, { key: childId }));
        } else {
          renderedChildren.push(rendered);
        }
      }
    }

    // Guard against empty tag names which cause React errors
    const tagName = node.tag || 'div';
    return React.createElement(tagName, attrs as Record<string, unknown>, ...renderedChildren);
  }

  // Document might not be ready initially if doc is loading
  const rootId = document?.getRootId();
  if (!rootId) return null;

  return <>{renderById(rootId)}</>;
}
