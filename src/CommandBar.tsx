import type { PlainList, PlainNode, PlainRecord, PlainRef, PrimitiveValue } from "@mydenicek/core";
import type { UseDenicekReturn } from "@mydenicek/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface CommandBarProps {
  dk: UseDenicekReturn;
}

interface OutputMessage {
  text: string;
  kind: "success" | "error" | "info";
}

// ── Type guards ──────────────────────────────────────────────────────────

function isPlainRecord(node: PlainNode): node is PlainRecord {
  return typeof node === "object" && node !== null && "$tag" in node && !("$items" in node) && !("$ref" in node);
}

function isPlainList(node: PlainNode): node is PlainList {
  return typeof node === "object" && node !== null && "$tag" in node && "$items" in node;
}

function isPlainRef(node: PlainNode): node is PlainRef {
  return typeof node === "object" && node !== null && "$ref" in node;
}

function isPrimitive(node: PlainNode): node is PrimitiveValue {
  return typeof node === "string" || typeof node === "number" || typeof node === "boolean";
}

// ── Tree rendering ───────────────────────────────────────────────────────

function renderTree(node: PlainNode, path: string, indent: number, lines: string[], maxDepth = 20): void {
  if (indent > maxDepth) {
    lines.push(`${"  ".repeat(indent)}...`);
    return;
  }
  const prefix = "  ".repeat(indent);

  if (isPrimitive(node)) {
    lines.push(`${prefix}${typeof node === "string" ? `"${node}"` : String(node)}`);
    return;
  }
  if (isPlainRef(node)) {
    lines.push(`${prefix}-> ${node.$ref}`);
    return;
  }
  if (isPlainList(node)) {
    lines.push(`${prefix}${path} [${node.$tag}] (${node.$items.length} items)`);
    node.$items.forEach((item, i) => {
      renderTree(item, `${i}`, indent + 1, lines, maxDepth);
    });
    return;
  }
  if (isPlainRecord(node)) {
    const tag = node.$tag as string;
    const kind = node["$kind"] as string | undefined;
    const SKIP = new Set(["$tag", "$id", "$kind", "$order"]);

    if (kind === "value") {
      const val = node["value"];
      lines.push(`${prefix}${path} = ${typeof val === "string" ? `"${val}"` : String(val)}`);
      return;
    }
    if (kind === "ref") {
      lines.push(`${prefix}${path} → ${node["target"]}`);
      return;
    }
    if (kind === "formula") {
      lines.push(`${prefix}${path} ƒ(${node["operation"]})`);
    } else if (kind === "action") {
      lines.push(`${prefix}${path} ▶ "${node["label"]}"`);
      return;
    } else {
      lines.push(`${prefix}{} ${path} <${tag}>`);
    }

    for (const [key, child] of Object.entries(node)) {
      if (SKIP.has(key)) continue;
      if (child !== undefined && typeof child === "object" && child !== null && "$tag" in child) {
        renderTree(child as PlainNode, key, indent + 1, lines, maxDepth);
      } else if (child !== undefined && !SKIP.has(key)) {
        const isKnownField = key === "value" || key === "label" || key === "operation" || key === "target" || key === "actions" || key === "params";
        if (!isKnownField) {
          lines.push(`${prefix}  @${key}=${typeof child === "string" ? `"${child}"` : String(child)}`);
        }
      }
    }
  }
}

// ── Navigate to a path in the plain tree ─────────────────────────────────

function navigateTo(root: PlainNode, segments: string[]): PlainNode | undefined {
  let current: PlainNode = root;
  for (const seg of segments) {
    if (isPlainRecord(current)) {
      if (seg in current && seg !== "$tag") {
        current = current[seg]!;
      } else {
        return undefined;
      }
    } else if (isPlainList(current)) {
      const idx = Number(seg);
      if (!Number.isNaN(idx) && idx >= 0 && idx < current.$items.length) {
        current = current.$items[idx]!;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return current;
}

const META_KEYS = new Set(["$tag", "$id", "$kind", "$order"]);

interface CompletionItem {
  name: string;
  label: string; // display text with type info
}

function getChildCompletions(node: PlainNode): CompletionItem[] {
  if (!isPlainRecord(node)) return [];
  const items: CompletionItem[] = [];
  for (const key of Object.keys(node)) {
    if (META_KEYS.has(key)) continue;
    const child = node[key];
    if (child === undefined) continue;
    if (isPlainRecord(child)) {
      const kind = child["$kind"] as string | undefined;
      const tag = child["$tag"] as string;
      if (kind === "value") {
        const val = child["value"];
        const display = typeof val === "string" ? `"${val.length > 20 ? val.slice(0, 20) + "…" : val}"` : String(val);
        items.push({ name: key, label: `${key} = ${display}` });
      } else if (kind === "ref") {
        items.push({ name: key, label: `${key} → ${child["target"]}` });
      } else if (kind === "formula") {
        items.push({ name: key, label: `${key} ƒ(${child["operation"]})` });
      } else if (kind === "action") {
        items.push({ name: key, label: `${key} ▶ "${child["label"]}"` });
      } else {
        items.push({ name: key, label: `{} ${key} <${tag}>` });
      }
    } else if (typeof child === "string") {
      const display = child.length > 25 ? child.slice(0, 25) + "…" : child;
      items.push({ name: key, label: `${key}: "${display}"` });
    } else if (typeof child === "number" || typeof child === "boolean") {
      items.push({ name: key, label: `${key}: ${child}` });
    }
  }
  return items;
}

// ── Parse value argument — try JSON first, fall back to string ──────────

function parseValue(raw: string): PlainNode {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed) as PlainNode; } catch { /* fall through */ }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

// ── All known commands ───────────────────────────────────────────────────

const COMMANDS = [
  "add", "delete", "rename", "set", "pushBack", "pushFront",
  "popBack", "popFront", "updateTag", "wrapRecord", "wrapList",
  "copy", "undo", "redo", "get", "tree", "help",
];

// Ghost hints: command → [arg after selector, ...]
const ARG_HINTS: Record<string, string[]> = {
  add: ["<field>", "<value>"],
  delete: ["<field>"],
  rename: ["<old>", "<new>"],
  set: ["<value>"],
  pushBack: ["<value>"],
  pushFront: ["<value>"],
  updateTag: ["<tag>"],
  wrapRecord: ["<field>", "<tag>"],
  wrapList: ["<tag>"],
  copy: ["<source-selector>"],
};

const HELP_TEXT = `Commands:
  add <selector> <field> <value|json>   Add a field to matched records
  delete <selector> <field>             Delete a field
  rename <selector> <old> <new>         Rename a field
  set <selector> <value>                Set a primitive value
  pushBack <selector> <value|json>      Append to a list
  pushFront <selector> <value|json>     Prepend to a list
  popBack <selector>                    Remove last list item
  popFront <selector>                   Remove first list item
  updateTag <selector> <tag>            Update structural tag
  wrapRecord <selector> <field> <tag>   Wrap in a record
  wrapList <selector> <tag>             Wrap in a list
  copy <target> <source>                Copy nodes
  undo / redo                           Undo or redo
  get <selector>                        Show nodes at selector
  tree [selector]                       Show document tree
  help                                  Show this help`;

// ── Component ────────────────────────────────────────────────────────────

export function CommandBar({ dk }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [output, setOutput] = useState<OutputMessage[]>([]);
  const [ghostText, setGhostText] = useState("");
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIdx, setCompletionIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // The materialized tree comes from the hook (re-renders on every mutation)
  const tree = dk.doc;

  // Tree text for `tree` command — start from the user root, skip CRDT wrapper
  const treeText = useMemo(() => {
    if (!tree || !isPlainRecord(tree)) return "(empty document)";
    const userRoot = tree["root"];
    if (!userRoot || !isPlainRecord(userRoot)) return "(no root node)";
    const lines: string[] = [];
    renderTree(userRoot, "/", 0, lines);
    return lines.join("\n");
  }, [tree]);

  // ── Path completion ─────────────────────────────────────────────────────

  /** Get the children available at the current path being typed. */
  const getPathCompletions = useCallback((text: string): { items: CompletionItem[]; prefix: string } => {
    const parts = text.split(/\s+/);
    if (parts.length <= 1) {
      const partial = parts[0] ?? "";
      return { items: COMMANDS.filter(c => c.startsWith(partial) && c !== partial).map(c => ({ name: c, label: c })), prefix: "" };
    }
    const selectorArg = parts[1] ?? "";
    if (!tree || !isPlainRecord(tree)) return { items: [], prefix: "" };

    const userRoot = tree["root"];
    if (!userRoot || !isPlainRecord(userRoot)) return { items: [], prefix: "" };

    const pathStr = selectorArg.startsWith("/") ? selectorArg.slice(1) : selectorArg;
    const segments = pathStr.split("/");
    const parentSegments = segments.slice(0, -1);
    const partial = segments[segments.length - 1] ?? "";

    const parentNode = parentSegments.length === 0 ? userRoot : navigateTo(userRoot, parentSegments);
    if (!parentNode) return { items: [], prefix: "" };

    const all = getChildCompletions(parentNode).filter(c => c.name.startsWith(partial));
    const prefix = "/" + (parentSegments.length > 0 ? parentSegments.join("/") + "/" : "");
    return { items: all, prefix };
  }, [tree]);

  /** Apply a selected completion item to the input. */
  const applyCompletion = useCallback((item: string) => {
    const parts = input.split(/\s+/);
    if (parts.length <= 1) {
      // Completing a command name
      setInput(item + " ");
    } else {
      // Completing a path — rebuild with "/" prefix
      const selectorArg = parts[1] ?? "";
      const pathStr = selectorArg.startsWith("/") ? selectorArg.slice(1) : selectorArg;
      const segments = pathStr.split("/");
      segments[segments.length - 1] = item;
      const newSelector = "/" + segments.join("/");
      const rest = parts.slice(2).join(" ");
      setInput(parts[0]! + " " + newSelector + (rest ? " " + rest : ""));
    }
    setCompletions([]);
    setCompletionIdx(-1);
    setGhostText("");
  }, [input]);

  /** Update completions list and ghost text when input changes. */
  const updateCompletions = useCallback((text: string) => {
    const { items } = getPathCompletions(text);
    const parts = text.split(/\s+/);
    const isPathCompletion = parts.length > 1;
    const partial = parts.length <= 1
      ? (parts[0] ?? "")
      : (parts[1] ?? "").split("/").pop() ?? "";

    if (items.length >= 1 && isPathCompletion) {
      // Always show dropdown for path completions so user sees what's available
      setCompletions(items);
      setCompletionIdx(-1);
      if (items.length === 1 && items[0]!.name !== partial) {
        setGhostText(items[0]!.name.slice(partial.length));
      } else {
        setGhostText("");
      }
    } else if (items.length === 1 && !isPathCompletion) {
      // Command completion — just ghost text
      setGhostText(items[0]!.name.slice(partial.length));
      setCompletions([]);
    } else {
      setCompletions([]);
      // Show argument hints when path is done but more args are needed
      const cmd = parts[0] ?? "";
      const hints = ARG_HINTS[cmd];
      if (hints && parts.length >= 2) {
        const extraArgs = parts.length - 2;
        if (extraArgs < hints.length) {
          setGhostText(" " + hints.slice(extraArgs).join(" "));
        } else {
          setGhostText("");
        }
      } else {
        setGhostText("");
      }
    }
  }, [getPathCompletions]);

  const handleTab = useCallback(() => {
    if (completions.length > 0) {
      const idx = completionIdx >= 0 ? completionIdx : 0;
      applyCompletion(completions[idx]!.name);
      return;
    }
    const { items } = getPathCompletions(input);
    if (items.length === 1) {
      applyCompletion(items[0]!.name);
    } else if (items.length > 1) {
      setCompletions(items);
      setCompletionIdx(0);
    }
  }, [input, completions, completionIdx, getPathCompletions, applyCompletion]);

  // ── Command execution ──────────────────────────────────────────────────

  const pushOutput = useCallback((msg: OutputMessage) => {
    setOutput(prev => [...prev.slice(-100), msg]);
  }, []);

  const executeCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    // Parse: first token is command, rest are args split by spaces
    // But value args can contain spaces if they're JSON
    const firstSpace = trimmed.indexOf(" ");
    const command = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    const argsStr = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

    // User paths start with "/" (like a filesystem). Internally the CRDT
    // stores the user root at field "root", so "/header" maps to "root/header".
    const SELECTOR_CMDS = new Set(["get", "tree", "add", "delete", "rename", "set", "pushBack", "pushFront", "popBack", "popFront", "updateTag", "wrapRecord", "wrapList", "copy"]);
    let effectiveArgs = argsStr;
    if (argsStr && SELECTOR_CMDS.has(command)) {
      const spaceIdx = argsStr.indexOf(" ");
      const selector = spaceIdx === -1 ? argsStr : argsStr.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? "" : argsStr.slice(spaceIdx);
      // Strip leading "/" and prepend "root/"
      const cleaned = selector.startsWith("/") ? selector.slice(1) : selector;
      effectiveArgs = (cleaned ? "root/" + cleaned : "root") + rest;
    }

    try {
      switch (command) {
        case "help":
          pushOutput({ text: HELP_TEXT, kind: "info" });
          break;

        case "undo": {
          const id = dk.undo();
          pushOutput({ text: `Undone → ${id}`, kind: "success" });
          break;
        }

        case "redo": {
          const id = dk.redo();
          pushOutput({ text: `Redone → ${id}`, kind: "success" });
          break;
        }

        case "tree": {
          if (argsStr) {
            const nodes = dk.get(effectiveArgs);
            if (nodes.length === 0) {
              pushOutput({ text: `No nodes at '${argsStr}'`, kind: "error" });
            } else {
              for (const n of nodes) {
                const lines: string[] = [];
                renderTree(n, argsStr.split("/").pop() ?? "node", 0, lines);
                pushOutput({ text: lines.join("\n"), kind: "info" });
              }
            }
          } else {
            pushOutput({ text: treeText, kind: "info" });
          }
          break;
        }

        case "get": {
          if (!argsStr) { pushOutput({ text: "Usage: get <selector>", kind: "error" }); break; }
          const nodes = dk.get(effectiveArgs);
          if (nodes.length === 0) {
            pushOutput({ text: `No nodes at '${argsStr}'`, kind: "error" });
          } else {
            pushOutput({ text: JSON.stringify(nodes, null, 2), kind: "info" });
          }
          break;
        }

        case "add": {
          const { args } = splitArgs(effectiveArgs, 3);
          if (args.length < 2) { pushOutput({ text: "Usage: add <selector> <field> [value|json]", kind: "error" }); break; }
          const [target, field] = args as [string, string];
          const value = args[2] ? parseValue(args[2]) : "";
          const id = dk.add(target!, field!, value);
          pushOutput({ text: `Added '${field}' to ${target} → ${id}`, kind: "success" });
          break;
        }

        case "delete": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: delete <selector> <field>", kind: "error" }); break; }
          const [target, field] = args as [string, string];
          const id = dk.delete(target!, field!);
          pushOutput({ text: `Deleted '${field}' from ${target} → ${id}`, kind: "success" });
          break;
        }

        case "rename": {
          const { args } = splitArgs(effectiveArgs, 3);
          if (args.length < 3) { pushOutput({ text: "Usage: rename <selector> <old-field> <new-field>", kind: "error" }); break; }
          const [target, from, to] = args as [string, string, string];
          const id = dk.rename(target!, from!, to!);
          pushOutput({ text: `Renamed '${from}' → '${to}' on ${target} → ${id}`, kind: "success" });
          break;
        }

        case "set": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: set <selector> <value>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          if (typeof value === "object") { pushOutput({ text: "set expects a primitive value (string, number, boolean)", kind: "error" }); break; }
          dk.set(target!, value as PrimitiveValue);
          pushOutput({ text: `Set ${argsStr.split(" ")[0]} = ${JSON.stringify(value)}`, kind: "success" });
          break;
        }

        case "pushBack": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: pushBack <selector> <value|json>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          const id = dk.pushBack(target!, value);
          pushOutput({ text: `Pushed to back of ${target} → ${id}`, kind: "success" });
          break;
        }

        case "pushFront": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: pushFront <selector> <value|json>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          const id = dk.pushFront(target!, value);
          pushOutput({ text: `Pushed to front of ${target} → ${id}`, kind: "success" });
          break;
        }

        case "popBack": {
          if (!argsStr) { pushOutput({ text: "Usage: popBack <selector>", kind: "error" }); break; }
          const id = dk.popBack(argsStr);
          pushOutput({ text: `Popped back from ${argsStr} → ${id}`, kind: "success" });
          break;
        }

        case "popFront": {
          if (!argsStr) { pushOutput({ text: "Usage: popFront <selector>", kind: "error" }); break; }
          const id = dk.popFront(argsStr);
          pushOutput({ text: `Popped front from ${argsStr} → ${id}`, kind: "success" });
          break;
        }

        case "updateTag": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: updateTag <selector> <new-tag>", kind: "error" }); break; }
          const [target, tag] = args as [string, string];
          const id = dk.updateTag(target!, tag!);
          pushOutput({ text: `Updated tag on ${target} → '${tag}' (${id})`, kind: "success" });
          break;
        }

        case "wrapRecord": {
          const { args } = splitArgs(effectiveArgs, 3);
          if (args.length < 3) { pushOutput({ text: "Usage: wrapRecord <selector> <field> <tag>", kind: "error" }); break; }
          const [target, field, tag] = args as [string, string, string];
          const id = dk.wrapRecord(target!, field!, tag!);
          pushOutput({ text: `Wrapped ${target} in record '${field}' [${tag}] → ${id}`, kind: "success" });
          break;
        }

        case "wrapList": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: wrapList <selector> <tag>", kind: "error" }); break; }
          const [target, tag] = args as [string, string];
          const id = dk.wrapList(target!, tag!);
          pushOutput({ text: `Wrapped ${target} in list [${tag}] → ${id}`, kind: "success" });
          break;
        }

        case "copy": {
          const { args } = splitArgs(effectiveArgs, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: copy <target> <source>", kind: "error" }); break; }
          const [target, source] = args as [string, string];
          const id = dk.copy(target!, source!);
          pushOutput({ text: `Copied ${source} → ${target} (${id})`, kind: "success" });
          break;
        }

        default:
          pushOutput({ text: `Unknown command: '${command}'. Type 'help' for available commands.`, kind: "error" });
      }
    } catch (err) {
      pushOutput({ text: String(err instanceof Error ? err.message : err), kind: "error" });
    }
  }, [dk, pushOutput, treeText]);

  // ── Key handlers ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      handleTab();
      return;
    }
    if (e.key === "Escape") {
      setCompletions([]);
      setCompletionIdx(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (completions.length > 0 && completionIdx >= 0) {
        applyCompletion(completions[completionIdx]!.name);
        return;
      }
      executeCommand(input);
      setInput("");
      setGhostText("");
      setCompletions([]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (completions.length > 0) {
        setCompletionIdx(prev => prev <= 0 ? completions.length - 1 : prev - 1);
        return;
      }
      if (history.length === 0) return;
      const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setInput(history[newIdx] ?? "");
      setGhostText("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (completions.length > 0) {
        setCompletionIdx(prev => prev >= completions.length - 1 ? 0 : prev + 1);
        return;
      }
      if (historyIndex === -1) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIdx);
        setInput(history[newIdx] ?? "");
      }
      setGhostText("");
      return;
    }
  }, [handleTab, executeCommand, input, history, historyIndex, completions, completionIdx, applyCompletion]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setHistoryIndex(-1);
    updateCompletions(val);
  }, [updateCompletions]);

  // ── Render ─────────────────────────────────────────────────────────────

  const lastMessage = output.length > 0 ? output[output.length - 1] : null;

  return (
    <div style={styles.container} onClick={() => inputRef.current?.focus()}>
      {/* Help overlay */}
      {showHelp && (
        <div style={styles.helpOverlay}>
          <pre style={styles.helpText}>{HELP_TEXT}</pre>
        </div>
      )}

      {/* Last output message */}
      {lastMessage && (
        <div style={{
          padding: "4px 12px",
          fontSize: 12,
          color: msgColor(lastMessage.kind),
          fontFamily: FONT,
          whiteSpace: "pre-wrap",
          overflowY: "auto",
          maxHeight: 300,
          borderTop: "1px solid #e0e0e0",
        }}>
          {lastMessage.text}
        </div>
      )}

      {/* Completions dropdown (above the input) */}
      {completions.length > 0 && (
        <div style={{
          borderTop: "1px solid #e0e0e0",
          background: "#fff",
          maxHeight: 180,
          overflowY: "auto",
          boxShadow: "0 -2px 8px rgba(0,0,0,0.1)",
        }}>
          {completions.map((item, i) => (
            <div
              key={item.name}
              onClick={() => applyCompletion(item.name)}
              style={{
                padding: "3px 12px 3px 28px",
                fontFamily: FONT,
                fontSize: 13,
                cursor: "pointer",
                background: i === completionIdx ? "#e8f0fe" : "transparent",
                color: i === completionIdx ? "#0078d4" : "#424242",
                borderLeft: i === completionIdx ? "3px solid #0078d4" : "3px solid transparent",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={styles.inputRow}>
        <span style={styles.prompt}>{">"}</span>
        <div style={styles.inputWrapper}>
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={styles.input}
            spellCheck={false}
            autoComplete="off"
            placeholder="Type a command (tab to complete)"
          />
          {ghostText && (
            <span style={styles.ghost}>
              <span style={{ visibility: "hidden" }}>{input}</span>{ghostText}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowHelp(v => !v); }}
          style={styles.helpButton}
          title="Show command help"
        >
          ?
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Split argsStr into at most `max` tokens; the last token gets the remainder. */
function splitArgs(argsStr: string, max: number): { args: string[] } {
  const args: string[] = [];
  let remaining = argsStr.trim();
  for (let i = 0; i < max - 1 && remaining; i++) {
    const spaceIdx = remaining.indexOf(" ");
    if (spaceIdx === -1) {
      args.push(remaining);
      remaining = "";
      break;
    }
    args.push(remaining.slice(0, spaceIdx));
    remaining = remaining.slice(spaceIdx + 1).trim();
  }
  if (remaining) args.push(remaining);
  return { args };
}

function msgColor(kind: OutputMessage["kind"]): string {
  switch (kind) {
    case "success": return "#107c10";
    case "error": return "#d13438";
    case "info": return "#424242";
  }
}

// ── Styles ───────────────────────────────────────────────────────────────

const FONT = "Consolas, Monaco, 'Courier New', monospace";

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "#fafafa",
    borderTop: "1px solid #e0e0e0",
    color: "#242424",
    fontFamily: FONT,
    fontSize: 13,
    flexShrink: 0,
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 12px",
    gap: 8,
  },
  prompt: {
    color: "#0078d4",
    fontWeight: "bold",
    fontSize: 14,
    userSelect: "none",
  },
  inputWrapper: {
    flex: 1,
    position: "relative",
  },
  input: {
    width: "100%",
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#242424",
    fontFamily: FONT,
    fontSize: 13,
    caretColor: "#242424",
    position: "relative",
    zIndex: 1,
  },
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    color: "#a0a0a0",
    fontFamily: FONT,
    fontSize: 13,
    pointerEvents: "none",
    whiteSpace: "pre",
    zIndex: 0,
  },
  helpButton: {
    background: "transparent",
    border: "1px solid #d0d0d0",
    borderRadius: 4,
    color: "#616161",
    fontFamily: FONT,
    fontSize: 12,
    width: 24,
    height: 24,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  helpOverlay: {
    padding: "8px 12px",
    borderBottom: "1px solid #e0e0e0",
    background: "#f0f0f0",
    maxHeight: 200,
    overflowY: "auto" as const,
  },
  helpText: {
    margin: 0,
    fontFamily: FONT,
    fontSize: 12,
    color: "#424242",
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
  },
};
