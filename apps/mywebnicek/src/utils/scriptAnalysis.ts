import type { GeneralizedPatch } from "@mydenicek/core";

/**
 * Check if an ID is a variable placeholder ($0, $1, $wrapper, etc.)
 */
function isVariablePlaceholder(id: string): boolean {
    return id.startsWith("$");
}

/**
 * Extract all concrete node IDs referenced in a script.
 * Returns unique IDs that appear in target, parent, sourceId fields.
 * Excludes variable placeholders ($0, $1, etc.) and created node targets.
 */
export function extractReferencedIds(script: GeneralizedPatch[]): string[] {
    const referencedIds = new Set<string>();
    const createdIds = new Set<string>();

    // First pass: identify created node IDs (targets of tree.create)
    for (const patch of script) {
        if (patch.type === "tree" && patch.action === "create") {
            if (!isVariablePlaceholder(patch.target)) {
                createdIds.add(patch.target);
            }
        }
    }

    // Second pass: collect all non-variable, non-created IDs
    const collectId = (id: string) => {
        if (!isVariablePlaceholder(id) && !createdIds.has(id)) {
            referencedIds.add(id);
        }
    };

    for (const patch of script) {
        if (patch.type === "tree") {
            if (patch.action === "create") {
                collectId(patch.parent);
                if (patch.sourceId) collectId(patch.sourceId);
            } else if (patch.action === "delete") {
                collectId(patch.target);
            } else if (patch.action === "move") {
                collectId(patch.target);
                collectId(patch.parent);
            }
        } else if (patch.type === "map" || patch.type === "text") {
            collectId(patch.target);
        }
    }

    return Array.from(referencedIds);
}

/**
 * Generalize a script by replacing concrete IDs with named parameter placeholders.
 * @param patches - The patches to generalize
 * @param params - Map of param name → concrete node ID (e.g., { wrapper: "abc123" })
 * @returns Generalized patches with $paramName placeholders and $1, $2 for created nodes
 */
export function generalizeScriptWithParams(
    patches: GeneralizedPatch[],
    params: Record<string, string>,
): GeneralizedPatch[] {
    // Build reverse mapping: concrete ID → $paramName
    const idToVar = new Map<string, string>();
    for (const [name, nodeId] of Object.entries(params)) {
        idToVar.set(nodeId, `$${name}`);
    }

    // Assign $1, $2, etc. to created nodes
    let varCounter = 1;
    for (const patch of patches) {
        if (patch.type === "tree" && patch.action === "create") {
            if (!idToVar.has(patch.target) && !isVariablePlaceholder(patch.target)) {
                idToVar.set(patch.target, `$${varCounter++}`);
            }
        }
    }

    // Replace all mapped IDs
    const resolve = (id: string): string => idToVar.get(id) ?? id;

    return patches.map(patch => {
        if (patch.type === "tree") {
            if (patch.action === "create") {
                return {
                    ...patch,
                    target: resolve(patch.target),
                    parent: resolve(patch.parent),
                    ...(patch.sourceId ? { sourceId: resolve(patch.sourceId) } : {}),
                };
            }
            if (patch.action === "delete") {
                return { ...patch, target: resolve(patch.target) };
            }
            if (patch.action === "move") {
                return { ...patch, target: resolve(patch.target), parent: resolve(patch.parent) };
            }
        }
        if (patch.type === "map") {
            return { ...patch, target: resolve(patch.target) };
        }
        if (patch.type === "text") {
            return { ...patch, target: resolve(patch.target) };
        }
        return patch;
    });
}

export interface CreatedNodeInfo {
    /** Sequential creation number within the selection (1-based) */
    number: number;
    /** Index of the create patch in the full script */
    actionIndex: number;
}

/**
 * Analyze selected patches to identify creation relationships.
 * Returns a map from concrete node ID → creation info.
 * The numbering is dynamic — computed from the current selection.
 */
export function analyzeSelection(
    script: GeneralizedPatch[],
    selectedIndices: Set<number>,
): Map<string, CreatedNodeInfo> {
    const createdNodes = new Map<string, CreatedNodeInfo>();
    let counter = 1;

    const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
        const patch = script[idx];
        if (patch && patch.type === "tree" && patch.action === "create") {
            if (!createdNodes.has(patch.target)) {
                createdNodes.set(patch.target, {
                    number: counter++,
                    actionIndex: idx,
                });
            }
        }
    }

    return createdNodes;
}

/**
 * Convert concrete-ID patches to generalized patches with $0, $1, etc.
 * Created nodes (targets of tree.create) get $1, $2, ...
 * If startNodeId is provided, that concrete ID maps to $0.
 * All other IDs stay concrete.
 */
export function generalizeScript(
    patches: GeneralizedPatch[],
    startNodeId?: string,
): GeneralizedPatch[] {
    const idMap = new Map<string, string>();
    let varCounter = 1;

    if (startNodeId) {
        idMap.set(startNodeId, "$0");
    }

    // First pass: assign variables to created nodes
    for (const patch of patches) {
        if (patch.type === "tree" && patch.action === "create") {
            if (!idMap.has(patch.target)) {
                idMap.set(patch.target, `$${varCounter++}`);
            }
        }
    }

    // Second pass: replace all mapped IDs
    const resolve = (id: string): string => idMap.get(id) ?? id;

    return patches.map(patch => {
        if (patch.type === "tree") {
            if (patch.action === "create") {
                return {
                    ...patch,
                    target: resolve(patch.target),
                    parent: resolve(patch.parent),
                    ...(patch.sourceId ? { sourceId: resolve(patch.sourceId) } : {}),
                };
            }
            if (patch.action === "delete") {
                return { ...patch, target: resolve(patch.target) };
            }
            if (patch.action === "move") {
                return { ...patch, target: resolve(patch.target), parent: resolve(patch.parent) };
            }
        }
        if (patch.type === "map") {
            return { ...patch, target: resolve(patch.target) };
        }
        if (patch.type === "text") {
            return { ...patch, target: resolve(patch.target) };
        }
        return patch;
    });
}

/**
 * Replace concrete IDs in patches using a global override map.
 * Replaces every occurrence of an overridden ID in all ID fields.
 */
export function applyIdOverrides(
    patches: GeneralizedPatch[],
    overrides: Map<string, string>,
): GeneralizedPatch[] {
    if (overrides.size === 0) return patches;

    const resolve = (id: string): string => overrides.get(id) ?? id;

    return patches.map(patch => {
        if (patch.type === "tree") {
            if (patch.action === "create") {
                return {
                    ...patch,
                    target: resolve(patch.target),
                    parent: resolve(patch.parent),
                    ...(patch.sourceId ? { sourceId: resolve(patch.sourceId) } : {}),
                };
            }
            if (patch.action === "delete") {
                return { ...patch, target: resolve(patch.target) };
            }
            if (patch.action === "move") {
                return { ...patch, target: resolve(patch.target), parent: resolve(patch.parent) };
            }
        }
        if (patch.type === "map") {
            return { ...patch, target: resolve(patch.target) };
        }
        if (patch.type === "text") {
            return { ...patch, target: resolve(patch.target) };
        }
        return patch;
    });
}
