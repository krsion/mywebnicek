import type { PlainNode, PlainRecord } from "@jsr/mydenicek__core";
import type { DenicekDocument } from "@mydenicek/document";
import React from "react";

function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && "$tag" in v && !("$items" in v) && !("$ref" in v);
}

const META = new Set(["$tag", "$id", "$kind"]);

interface Props {
    document: DenicekDocument;
}

export function RenderedDocument({ document }: Props) {
    const tree = document.denicekInstance.materialize();
    if (!isRec(tree)) return <div>Empty document</div>;
    const root = tree["root"];
    if (!root || !isRec(root)) return <div>No root node</div>;
    return <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>{renderNode(root)}</div>;
}

function renderNode(node: PlainNode): React.ReactNode {
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (!isRec(node)) return null;

    const tag = String(node.$tag);
    const kind = node.$kind as string | undefined;

    // Value nodes: render text content
    if (kind === "value") {
        return <>{String(node.value ?? "")}</>;
    }

    // Formula nodes: show placeholder
    if (kind === "formula") {
        return <code style={{ background: "#e8f4e8", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
            {`\u0192(${node.operation})`}
        </code>;
    }

    // Ref nodes: show link
    if (kind === "ref") {
        return <span style={{ color: "#0078d4", textDecoration: "underline" }}>{`\u2192 ${node.target}`}</span>;
    }

    // Action nodes: render as button
    if (kind === "action") {
        return <button style={{ padding: "4px 12px", cursor: "pointer", margin: "2px" }}>
            {String(node.label ?? "Action")}
        </button>;
    }

    // Element nodes: render as the HTML tag
    const children: React.ReactNode[] = [];
    const attrs: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(node)) {
        if (META.has(key) || val === undefined) continue;
        if (isRec(val)) {
            children.push(<React.Fragment key={key}>{renderNode(val)}</React.Fragment>);
        } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            // Could be an attribute or a primitive child
            // If it looks like an HTML attribute, store it
            if (key === "class" || key === "href" || key === "src" || key === "alt" || key === "type" || key === "placeholder") {
                attrs[key === "class" ? "className" : key] = val;
            }
            // Skip other primitives (they are CRDT metadata attributes)
        }
    }

    // Map tag to React element, using safe subset of HTML tags
    const safeTags = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
        "header", "main", "section", "article", "nav", "footer",
        "strong", "em", "a", "img", "br", "hr", "pre", "code",
        "button", "input", "label", "form", "blockquote"]);

    const htmlTag = safeTags.has(tag) ? tag : "div";

    return React.createElement(htmlTag, { ...attrs }, ...children);
}
