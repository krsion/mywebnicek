import type { PlainList, PlainNode, PlainRecord, PlainRef } from "@mydenicek/core";
import React from "react";

function isRec(v: PlainNode): v is PlainRecord {
    return typeof v === "object" && v !== null && "$tag" in v && !("$items" in v) && !("$ref" in v);
}
function isList(v: PlainNode): v is PlainList {
    return typeof v === "object" && v !== null && "$tag" in v && "$items" in v;
}
function isRef(v: PlainNode): v is PlainRef {
    return typeof v === "object" && v !== null && "$ref" in v;
}

const META = new Set(["$tag", "$id", "$kind"]);

interface Props {
    doc: PlainNode;
}

export function RenderedDocument({ doc }: Props) {
    if (!isRec(doc)) return <div style={styles.empty}>Empty document</div>;
    const root = doc["root"];
    if (!root) return <div style={styles.empty}>No root node</div>;
    return <div style={styles.root}><Node node={root} name="/" depth={0} /></div>;
}

function Node({ node, name, depth }: { node: PlainNode; name: string; depth: number }): React.ReactElement {
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return <div style={{ ...styles.leaf, marginLeft: depth * 16 }}>
            <span style={styles.name}>{name}</span>
            <span style={styles.primitive}>{JSON.stringify(node)}</span>
        </div>;
    }
    if (isRef(node)) {
        return <div style={{ ...styles.leaf, marginLeft: depth * 16 }}>
            <span style={styles.name}>{name}</span>
            <span style={styles.ref}>→ {node.$ref}</span>
        </div>;
    }
    if (isList(node)) {
        return <div style={{ marginLeft: depth * 16 }}>
            <div style={styles.header}>
                <span style={styles.name}>{name}</span>
                <span style={styles.tag}>[{node.$tag}]</span>
                <span style={styles.count}>{node.$items.length}</span>
            </div>
            {node.$items.map((item, i) =>
                <Node key={i} node={item} name={String(i)} depth={depth + 1} />
            )}
        </div>;
    }
    if (isRec(node)) {
        const tag = String(node.$tag);
        const children: [string, PlainNode][] = [];
        for (const [key, val] of Object.entries(node)) {
            if (!META.has(key) && val !== undefined) children.push([key, val as PlainNode]);
        }
        return <div style={{ marginLeft: depth * 16 }}>
            <div style={styles.header}>
                <span style={styles.name}>{name}</span>
                <span style={styles.tag}>&lt;{tag}&gt;</span>
            </div>
            {children.map(([key, val]) =>
                <Node key={key} node={val} name={key} depth={depth + 1} />
            )}
        </div>;
    }
    return <div style={{ marginLeft: depth * 16, color: "#999" }}>{name}: (unknown)</div>;
}

const styles: Record<string, React.CSSProperties> = {
    root: { fontFamily: "Consolas, Monaco, monospace", fontSize: 13, lineHeight: 1.6, padding: 8 },
    empty: { color: "#888", padding: 20, fontFamily: "system-ui" },
    header: { display: "flex", gap: 6, alignItems: "baseline" },
    leaf: { display: "flex", gap: 6, alignItems: "baseline" },
    name: { color: "#0078d4", fontWeight: 600 },
    tag: { color: "#888", fontSize: 12 },
    count: { color: "#888", fontSize: 11 },
    primitive: { color: "#b5533c" },
    ref: { color: "#6f42c1", fontStyle: "italic" },
};
