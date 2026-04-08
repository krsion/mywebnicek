import type { PlainNode, PlainRecord } from "@mydenicek/core";
import React from "react";

function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && "$tag" in v && !("$items" in v) && !("$ref" in v);
}

const META = new Set(["$tag", "$id", "$kind"]);
const HTML_TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
    "header", "main", "section", "article", "nav", "footer",
    "strong", "em", "a", "img", "br", "hr", "pre", "code",
    "button", "input", "label", "form", "blockquote"]);

interface Props {
    doc: PlainNode;
}

export function RenderedDocument({ doc }: Props) {
    if (!isRec(doc)) return <div style={{ color: "#888", padding: 20 }}>Empty document</div>;
    const root = doc["root"];
    if (!root || !isRec(root)) return <div style={{ color: "#888", padding: 20 }}>No root node</div>;
    return (
        <RenderErrorBoundary>
            <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
                {renderNode(root)}
            </div>
        </RenderErrorBoundary>
    );
}

function renderNode(node: PlainNode): React.ReactNode {
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (!isRec(node)) return null;

    const tag = String(node.$tag);

    // Render children: records recurse, primitives render as text
    const children: React.ReactNode[] = [];
    for (const [key, val] of Object.entries(node)) {
        if (META.has(key) || val === undefined) continue;
        if (isRec(val)) {
            children.push(<React.Fragment key={key}>{renderNode(val)}</React.Fragment>);
        } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            children.push(<React.Fragment key={key}>{String(val)}</React.Fragment>);
        }
    }

    // Only render known HTML tags; unknown tags become <div>
    const htmlTag = HTML_TAGS.has(tag) ? tag : "div";
    return React.createElement(htmlTag, {}, ...children);
}

/** Catches rendering errors from invalid HTML nesting and shows a message. */
class RenderErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { error: string | null }
> {
    state = { error: null as string | null };
    static getDerivedStateFromError(err: Error) {
        return { error: err.message };
    }
    render() {
        if (this.state.error) {
            return <div style={{ padding: 12, background: "#fff4e5", border: "1px solid #ffb74d", borderRadius: 4, color: "#e65100", fontSize: 13 }}>
                Render error: {this.state.error}
            </div>;
        }
        return this.props.children;
    }
}
