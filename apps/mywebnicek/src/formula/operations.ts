/**
 * Built-in formula operations for mywebnicek
 *
 * Operations are defined here and passed to the formula engine via FormulaContext.
 * This follows the callback pattern - the engine is in core, operations are app-defined.
 */

import type { FormulaContext, Operation } from "@mydenicek/core";

// =============================================================================
// Type validation helpers
// =============================================================================

/**
 * Check if a value is an error result (starts with #ERR)
 */
function isError(v: unknown): boolean {
    return typeof v === "string" && v.startsWith("#ERR");
}

/**
 * Require a string value, with number-to-string coercion
 * Returns an error string starting with #ERR if validation fails
 */
function requireString(v: unknown, opName: string): string {
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    return `#ERR: ${opName} requires string`;
}

/**
 * Require a number value, with string-to-number coercion
 */
function requireNumber(v: unknown, opName: string): number | string {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
        if (v.startsWith("#ERR")) return v;
        const n = Number(v);
        if (!isNaN(n)) return n;
    }
    return `#ERR: ${opName} requires number`;
}

// =============================================================================
// String operations
// =============================================================================

const lowerText: Operation = {
    name: "lowerText",
    arity: 1,
    execute: ([s]) => {
        const str = requireString(s, "lowerText");
        if (str.startsWith("#ERR")) return str;
        return str.toLowerCase();
    },
};

const upperText: Operation = {
    name: "upperText",
    arity: 1,
    execute: ([s]) => {
        const str = requireString(s, "upperText");
        if (str.startsWith("#ERR")) return str;
        return str.toUpperCase();
    },
};

const capitalize: Operation = {
    name: "capitalize",
    arity: 1,
    execute: ([s]) => {
        const str = requireString(s, "capitalize");
        if (str.startsWith("#ERR")) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    },
};

const concat: Operation = {
    name: "concat",
    arity: -1, // variadic
    execute: (args) => {
        // Check for errors in arguments
        for (const arg of args) {
            if (isError(arg)) return arg;
        }
        return args.map((a) => String(a)).join("");
    },
};

const trim: Operation = {
    name: "trim",
    arity: 1,
    execute: ([s]) => {
        const str = requireString(s, "trim");
        if (str.startsWith("#ERR")) return str;
        return str.trim();
    },
};

const length: Operation = {
    name: "length",
    arity: 1,
    execute: ([s]) => {
        const str = requireString(s, "length");
        if (str.startsWith("#ERR")) return str;
        return str.length;
    },
};

const replace: Operation = {
    name: "replace",
    arity: 3,
    execute: ([s, find, repl]) => {
        const str = requireString(s, "replace");
        if (str.startsWith("#ERR")) return str;
        const findStr = requireString(find, "replace");
        if (findStr.startsWith("#ERR")) return findStr;
        const replStr = requireString(repl, "replace");
        if (replStr.startsWith("#ERR")) return replStr;
        return str.replaceAll(findStr, replStr);
    },
};

// =============================================================================
// Array/Index operations
// =============================================================================

const atIndex: Operation = {
    name: "atIndex",
    arity: 2,
    execute: ([arr, i]) => {
        const idx = requireNumber(i, "atIndex");
        if (typeof idx === "string" && idx.startsWith("#ERR")) return idx;
        if (Array.isArray(arr)) {
            const val = arr[idx as number];
            return val !== undefined ? val : `#ERR: index out of bounds`;
        }
        const str = requireString(arr, "atIndex");
        if (str.startsWith("#ERR")) return str;
        return str[idx as number] ?? "";
    },
};

const splitString: Operation = {
    name: "splitString",
    arity: 2,
    execute: ([s, sep]) => {
        const str = requireString(s, "splitString");
        if (str.startsWith("#ERR")) return str;
        const sepStr = requireString(sep, "splitString");
        if (sepStr.startsWith("#ERR")) return sepStr;
        return str.split(sepStr);
    },
};

const arrayLength: Operation = {
    name: "arrayLength",
    arity: 1,
    execute: ([arr]) => {
        if (Array.isArray(arr)) return arr.length;
        const str = requireString(arr, "arrayLength");
        if (str.startsWith("#ERR")) return str;
        return str.length;
    },
};

// =============================================================================
// Math operations
// =============================================================================

const product: Operation = {
    name: "product",
    arity: -1, // Variadic - multiplies all children
    execute: (args) => {
        let result = 1;
        for (const arg of args) {
            const n = requireNumber(arg, "product");
            if (typeof n === "string") return n; // Error
            result *= n;
        }
        return result;
    },
};

const mod: Operation = {
    name: "mod",
    arity: 2,
    execute: ([a, b]) => {
        const na = requireNumber(a, "mod");
        if (typeof na === "string") return na;
        const nb = requireNumber(b, "mod");
        if (typeof nb === "string") return nb;
        return na % nb;
    },
};

const round: Operation = {
    name: "round",
    arity: 1,
    execute: ([n]) => {
        const num = requireNumber(n, "round");
        if (typeof num === "string") return num;
        return Math.round(num);
    },
};

const floor: Operation = {
    name: "floor",
    arity: 1,
    execute: ([n]) => {
        const num = requireNumber(n, "floor");
        if (typeof num === "string") return num;
        return Math.floor(num);
    },
};

const ceil: Operation = {
    name: "ceil",
    arity: 1,
    execute: ([n]) => {
        const num = requireNumber(n, "ceil");
        if (typeof num === "string") return num;
        return Math.ceil(num);
    },
};

const abs: Operation = {
    name: "abs",
    arity: 1,
    execute: ([n]) => {
        const num = requireNumber(n, "abs");
        if (typeof num === "string") return num;
        return Math.abs(num);
    },
};

const add: Operation = {
    name: "add",
    arity: 2,
    execute: ([a, b]) => {
        const na = requireNumber(a, "add");
        if (typeof na === "string") return na;
        const nb = requireNumber(b, "add");
        if (typeof nb === "string") return nb;
        return na + nb;
    },
};

const subtract: Operation = {
    name: "subtract",
    arity: 2,
    execute: ([a, b]) => {
        const na = requireNumber(a, "subtract");
        if (typeof na === "string") return na;
        const nb = requireNumber(b, "subtract");
        if (typeof nb === "string") return nb;
        return na - nb;
    },
};

const divide: Operation = {
    name: "divide",
    arity: 2,
    execute: ([a, b]) => {
        const na = requireNumber(a, "divide");
        if (typeof na === "string") return na;
        const nb = requireNumber(b, "divide");
        if (typeof nb === "string") return nb;
        if (nb === 0) return `#ERR: division by zero`;
        return na / nb;
    },
};

// =============================================================================
// Tree operations
// =============================================================================

const countChildren: Operation = {
    name: "countChildren",
    arity: 1,
    execute: ([nodeId], ctx: FormulaContext) => {
        const id = requireString(nodeId, "countChildren");
        if (id.startsWith("#ERR")) return id;
        return ctx.document.getChildIds(id).length;
    },
};

// =============================================================================
// All built-in operations
// =============================================================================

export const builtinOperations: Operation[] = [
    // String
    lowerText,
    upperText,
    capitalize,
    concat,
    trim,
    length,
    replace,
    // Array/Index
    atIndex,
    splitString,
    arrayLength,
    // Math
    add,
    subtract,
    divide,
    product,
    mod,
    round,
    floor,
    ceil,
    abs,
    // Tree
    countChildren,
];

/**
 * Create an operations map from an array of operations
 */
export function createOperationsMap(ops: Operation[]): Map<string, Operation> {
    return new Map(ops.map((op) => [op.name, op]));
}

/**
 * The default operations map with all built-in operations
 */
export const defaultOperationsMap = createOperationsMap(builtinOperations);

/**
 * List of all built-in operation names (for UI dropdowns)
 */
export const builtinOperationNames = builtinOperations.map((op) => op.name);
