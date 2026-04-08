import type { PlainNode, PlainRecord } from "@mydenicek/core";
import React from "react";

function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && "$tag" in v && !("$items" in v) && !("$ref" in v);
}

const META = new Set(["$tag", "$id", "$kind"]);
const safeTags = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
    "header", "main", "section", "article", "nav", "footer",
    "strong", "em", "a", "img", "br", "hr", "pre", "code",
    "button", "input", "label", "form", "blockquote"]);

const nameLabel: React.CSSProperties = {
    display: "inline-block",
    fontSize: 10,
    fontFamily: "Consolas, monospace",
    color: "#8a8a8a",
    background: "#f0f0f0",
    borderRadius: 3,
    padding: "0 4px",
    marginRight: 4,
    verticalAlign: "middle",
    lineHeight: "16px",
};

interface Props {
    doc: PlainNode;
}

export function RenderedDocument({ doc }: Props) {
    if (!isRec(doc)) return <div style={{ color: "#888", padding: 20 }}>Empty document</div>;
    const root = doc["root"];
    if (!root || !isRec(root)) return <div style={{ color: "#888", padding: 20 }}>No root node</div>;
    return <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>{renderNode(root, "")}</div>;
}

function renderNode(node: PlainNode, fieldName: string): React.ReactNode {
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (!isRec(node)) return null;

    const tag = String(node.$tag);
    const kind = node.$kind as string | undefined;

    // Support both $kind-based (legacy data) and $tag-based (simplified) detection
    if (kind === "value" || tag === "$value") {
        return <>{String(node.value ?? "")}</>;
    }
    if (kind === "formula" || tag === "$formula") {
        return <code style={{ background: "#e8f4e8", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
            ƒ({String(node.operation)})
        </code>;
    }
    if (kind === "ref" || tag === "$ref") {
        return <span style={{ color: "#0078d4", textDecoration: "underline" }}>→ {String(node.target)}</span>;
    }
    if (kind === "action" || tag === "$action") {
        return <button type="button" style={{ padding: "4px 12px", cursor: "pointer", margin: "2px" }}>
            {String(node.label ?? "Action")}
        </button>;
    }

    // Element node — render with field name label
    const children: React.ReactNode[] = [];
    for (const [key, val] of Object.entries(node)) {
        if (META.has(key) || val === undefined) continue;
        children.push(<React.Fragment key={key}>{renderNode(val, key)}</React.Fragment>);
    }

    const htmlTag = safeTags.has(tag) ? tag : "div";
    const label = fieldName ? <span style={nameLabel}>{fieldName}</span> : null;

    return React.createElement(htmlTag, {}, label, ...children);
}
