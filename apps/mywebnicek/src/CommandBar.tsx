import type { Denicek, PlainList, PlainNode, PlainRecord, PlainRef, PrimitiveValue } from "@jsr/mydenicek__core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface CommandBarProps {
  denicek: Denicek;
  version: number;
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
    lines.push(`${prefix}${path} [${node.$tag}] (list, ${node.$items.length} items)`);
    node.$items.forEach((item, i) => {
      renderTree(item, `${i}`, indent + 1, lines, maxDepth);
    });
    return;
  }
  if (isPlainRecord(node)) {
    const tag = node.$tag as string;
    const id = node["$id"] as string | undefined;
    const kind = node["$kind"] as string | undefined;
    // For element nodes, show a clean tree line
    if (kind === "value") {
      const val = node["value"];
      lines.push(`${prefix}${path} = ${typeof val === "string" ? `"${val}"` : String(val)}`);
      return;
    }
    if (kind === "ref") {
      lines.push(`${prefix}${path} -> ${node["target"]}`);
      return;
    }
    if (kind === "formula") {
      lines.push(`${prefix}${path} ƒ(${node["operation"]})`);
    } else {
      lines.push(`${prefix}${path} [${tag}]${id ? "" : ""}`);
    }
    const META = new Set(["$tag", "$id", "$kind", "$order"]);
    for (const [key, child] of Object.entries(node)) {
      if (META.has(key)) continue;
      if (child !== undefined && typeof child === "object" && child !== null && "$tag" in child) {
        renderTree(child as PlainNode, key, indent + 1, lines, maxDepth);
      } else if (child !== undefined && !META.has(key)) {
        // Show primitive attributes inline
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

function getChildKeys(node: PlainNode): string[] {
  if (isPlainRecord(node)) {
    return Object.keys(node).filter(k => k !== "$tag");
  }
  if (isPlainList(node)) {
    return node.$items.map((_, i) => String(i));
  }
  return [];
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

export function CommandBar({ denicek, version }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [output, setOutput] = useState<OutputMessage[]>([]);
  const [ghostText, setGhostText] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Materialize tree
  const tree = useMemo(() => {
    try { return denicek.materialize(); }
    catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denicek, version]);

  // Tree text for `tree` command
  const treeText = useMemo(() => {
    if (!tree) return "(empty document)";
    const lines: string[] = [];
    renderTree(tree, "root", 0, lines);
    return lines.join("\n");
  }, [tree]);

  // ── Tab completion ─────────────────────────────────────────────────────

  const computeCompletions = useCallback((text: string): string[] => {
    const parts = text.split(/\s+/);
    if (parts.length <= 1) {
      // Complete command name
      const partial = parts[0] ?? "";
      return COMMANDS.filter(c => c.startsWith(partial) && c !== partial);
    }
    // Complete selector path (second argument for most commands)
    const selectorArg = parts[1] ?? "";
    if (!tree) return [];

    const segments = selectorArg.split("/");
    const parentSegments = segments.slice(0, -1);
    const partial = segments[segments.length - 1] ?? "";

    // Navigate past "root" if it's the first segment
    let navSegments = parentSegments;
    if (navSegments[0] === "root") {
      navSegments = navSegments.slice(1);
    }

    const parentNode = navSegments.length === 0 ? tree : navigateTo(tree, navSegments);
    if (!parentNode) return [];

    const keys = getChildKeys(parentNode);
    return keys
      .filter(k => k.startsWith(partial) && k !== partial)
      .map(k => {
        const prefix = parentSegments.length > 0 ? parentSegments.join("/") + "/" : (selectorArg.startsWith("root") ? "root/" : "");
        return prefix + k;
      });
  }, [tree]);

  const updateGhost = useCallback((text: string) => {
    const completions = computeCompletions(text);
    if (completions.length === 1) {
      const parts = text.split(/\s+/);
      if (parts.length <= 1) {
        setGhostText(completions[0]!.slice((parts[0] ?? "").length));
      } else {
        const selectorArg = parts[1] ?? "";
        const fullCompletion = completions[0]!;
        setGhostText(fullCompletion.slice(selectorArg.length));
      }
    } else {
      setGhostText("");
    }
  }, [computeCompletions]);

  const handleTab = useCallback(() => {
    const completions = computeCompletions(input);
    if (completions.length === 0) return;

    const parts = input.split(/\s+/);
    if (parts.length <= 1) {
      // Complete command
      if (completions.length === 1) {
        setInput(completions[0]! + " ");
        setGhostText("");
      } else {
        pushOutput({ text: completions.join("  "), kind: "info" });
      }
    } else {
      // Complete selector
      if (completions.length === 1) {
        const prefix = parts[0]! + " ";
        const rest = parts.slice(2).join(" ");
        setInput(prefix + completions[0]! + (rest ? " " + rest : ""));
        setGhostText("");
      } else {
        // Show available completions
        const segments = (parts[1] ?? "").split("/");
        const partial = segments[segments.length - 1] ?? "";
        const suffixes = completions.map(c => {
          const cSegments = c.split("/");
          return cSegments[cSegments.length - 1] ?? c;
        }).filter(s => s.startsWith(partial));
        pushOutput({ text: suffixes.join("  "), kind: "info" });
      }
    }
  }, [input, computeCompletions]);

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

    try {
      switch (command) {
        case "help":
          pushOutput({ text: HELP_TEXT, kind: "info" });
          break;

        case "undo": {
          const id = denicek.undo();
          pushOutput({ text: `Undone → ${id}`, kind: "success" });
          break;
        }

        case "redo": {
          const id = denicek.redo();
          pushOutput({ text: `Redone → ${id}`, kind: "success" });
          break;
        }

        case "tree": {
          if (argsStr) {
            const nodes = denicek.get(argsStr);
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
          const nodes = denicek.get(argsStr);
          if (nodes.length === 0) {
            pushOutput({ text: `No nodes at '${argsStr}'`, kind: "error" });
          } else {
            pushOutput({ text: JSON.stringify(nodes, null, 2), kind: "info" });
          }
          break;
        }

        case "add": {
          const { args } = splitArgs(argsStr, 3);
          if (args.length < 2) { pushOutput({ text: "Usage: add <selector> <field> [value|json]", kind: "error" }); break; }
          const [target, field] = args as [string, string];
          const value = args[2] ? parseValue(args[2]) : "";
          const id = denicek.add(target!, field!, value);
          pushOutput({ text: `Added '${field}' to ${target} → ${id}`, kind: "success" });
          break;
        }

        case "delete": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: delete <selector> <field>", kind: "error" }); break; }
          const [target, field] = args as [string, string];
          const id = denicek.delete(target!, field!);
          pushOutput({ text: `Deleted '${field}' from ${target} → ${id}`, kind: "success" });
          break;
        }

        case "rename": {
          const { args } = splitArgs(argsStr, 3);
          if (args.length < 3) { pushOutput({ text: "Usage: rename <selector> <old-field> <new-field>", kind: "error" }); break; }
          const [target, from, to] = args as [string, string, string];
          const id = denicek.rename(target!, from!, to!);
          pushOutput({ text: `Renamed '${from}' → '${to}' on ${target} → ${id}`, kind: "success" });
          break;
        }

        case "set": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: set <selector> <value>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          if (typeof value === "object") { pushOutput({ text: "set expects a primitive value (string, number, boolean)", kind: "error" }); break; }
          const id = denicek.set(target!, value as PrimitiveValue);
          pushOutput({ text: `Set ${target} = ${JSON.stringify(value)} → ${id}`, kind: "success" });
          break;
        }

        case "pushBack": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: pushBack <selector> <value|json>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          const id = denicek.pushBack(target!, value);
          pushOutput({ text: `Pushed to back of ${target} → ${id}`, kind: "success" });
          break;
        }

        case "pushFront": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: pushFront <selector> <value|json>", kind: "error" }); break; }
          const [target] = args as [string];
          const value = parseValue(args[1]!);
          const id = denicek.pushFront(target!, value);
          pushOutput({ text: `Pushed to front of ${target} → ${id}`, kind: "success" });
          break;
        }

        case "popBack": {
          if (!argsStr) { pushOutput({ text: "Usage: popBack <selector>", kind: "error" }); break; }
          const id = denicek.popBack(argsStr);
          pushOutput({ text: `Popped back from ${argsStr} → ${id}`, kind: "success" });
          break;
        }

        case "popFront": {
          if (!argsStr) { pushOutput({ text: "Usage: popFront <selector>", kind: "error" }); break; }
          const id = denicek.popFront(argsStr);
          pushOutput({ text: `Popped front from ${argsStr} → ${id}`, kind: "success" });
          break;
        }

        case "updateTag": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: updateTag <selector> <new-tag>", kind: "error" }); break; }
          const [target, tag] = args as [string, string];
          const id = denicek.updateTag(target!, tag!);
          pushOutput({ text: `Updated tag on ${target} → '${tag}' (${id})`, kind: "success" });
          break;
        }

        case "wrapRecord": {
          const { args } = splitArgs(argsStr, 3);
          if (args.length < 3) { pushOutput({ text: "Usage: wrapRecord <selector> <field> <tag>", kind: "error" }); break; }
          const [target, field, tag] = args as [string, string, string];
          const id = denicek.wrapRecord(target!, field!, tag!);
          pushOutput({ text: `Wrapped ${target} in record '${field}' [${tag}] → ${id}`, kind: "success" });
          break;
        }

        case "wrapList": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: wrapList <selector> <tag>", kind: "error" }); break; }
          const [target, tag] = args as [string, string];
          const id = denicek.wrapList(target!, tag!);
          pushOutput({ text: `Wrapped ${target} in list [${tag}] → ${id}`, kind: "success" });
          break;
        }

        case "copy": {
          const { args } = splitArgs(argsStr, 2);
          if (args.length < 2) { pushOutput({ text: "Usage: copy <target> <source>", kind: "error" }); break; }
          const [target, source] = args as [string, string];
          const id = denicek.copy(target!, source!);
          pushOutput({ text: `Copied ${source} → ${target} (${id})`, kind: "success" });
          break;
        }

        default:
          pushOutput({ text: `Unknown command: '${command}'. Type 'help' for available commands.`, kind: "error" });
      }
    } catch (err) {
      pushOutput({ text: String(err instanceof Error ? err.message : err), kind: "error" });
    }
  }, [denicek, pushOutput, treeText]);

  // ── Key handlers ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      handleTab();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(input);
      setInput("");
      setGhostText("");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setInput(history[newIdx] ?? "");
      setGhostText("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
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
  }, [handleTab, executeCommand, input, history, historyIndex]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setHistoryIndex(-1);
    updateGhost(val);
  }, [updateGhost]);

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
        <div style={{ padding: "2px 12px", fontSize: 12, color: msgColor(lastMessage.kind), fontFamily: FONT, whiteSpace: "pre-wrap", overflow: "hidden", maxHeight: 60 }}>
          {lastMessage.text}
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
              {input}{ghostText}
            </span>
          )}
        </div>
        <button
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
