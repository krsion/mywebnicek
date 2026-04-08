# Formative Examples

**Project**: mywebnicek
**Author**: Bc. Ondřej Krsička
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.
**Institution**: Charles University, Faculty of Mathematics and Physics

---

## Introduction

mywebnicek is a local-first collaborative document editor built on a custom CRDT
(Conflict-free Replicated Data Type). The core package, `@mydenicek/core`
(published on JSR), models documents as **tagged trees** composed of four node
types: **records**, **lists**, **primitives**, and **references**.

The main entry point is the `Denicek` class. Each `Denicek` instance represents
an independent peer that can:

- Edit a document locally (set values, add/remove fields, push/pop list items).
- Perform structural edits (wrap nodes into records or lists, rename fields,
  update tags).
- Synchronize with other peers by exchanging events over a causal event DAG.
- Record edit sequences and replay them — enabling user-programmable buttons and
  actions.

All peers that receive the same set of events converge to the **same document
state**, regardless of the order in which events are delivered. This is the
strong eventual consistency guarantee of the CRDT.

The following six examples demonstrate the core capabilities of the system, from
basic operations to collaborative multi-peer editing with concurrent structural
transformations.

---

## 1. Hello World — Primitive Edits and Replay

### Problem Description

We have a simple application containing a list of messages with inconsistent
capitalization. We want to apply a custom "capitalize" transformation to one
message, then **replay** that same transformation across all messages in the
list.

This example demonstrates two key features:

- **Custom primitive edits** — extending the CRDT with domain-specific
  transformations.
- **Edit replay with wildcards** — applying a recorded edit to all children of a
  list using the `*` wildcard selector.

### Step-by-Step Walkthrough

1. **Initialize the document** with a tagged list of messages.
2. **Register a custom primitive edit** called `"capitalize"` that title-cases a
   string.
3. **Apply the edit to a single message** (`messages/0`) on the "recorded" peer.
4. **Sync** the recorded peer's events to a "replay" peer.
5. **Replay the edit** on the replay peer, targeting `messages/*` — which applies
   the same transformation to every item in the list.

### Code

```typescript
import { Denicek, registerPrimitiveEdit } from "@mydenicek/core";

// Define the capitalize transformation
const capitalizeWords = (message: string): string =>
  message
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

// Register it as a primitive edit the CRDT can track
registerPrimitiveEdit("capitalize", (value) => {
  if (typeof value !== "string") {
    throw new Error("capitalize expects a string.");
  }
  return capitalizeWords(value);
});

// Create the initial document
const initialDocument = {
  $tag: "app",
  messages: {
    $tag: "ul",
    $items: ["heLLo woRLD", "gOOD mORning", "denICEk FORmative"],
  },
};

// Two peers start from the same document
const recordedPeer = new Denicek("recorded", initialDocument);
const replayPeer = new Denicek("replay", initialDocument);

// Apply capitalize to the first message on the recorded peer
const capitalizeEventId = recordedPeer.applyPrimitiveEdit(
  "messages/0",
  "capitalize",
);

// Sync events to the replay peer
for (const event of recordedPeer.drain()) {
  replayPeer.applyRemote(event);
}

// Replay the same edit across ALL messages using the wildcard selector
replayPeer.replayEditFromEventId(capitalizeEventId, "messages/*");
```

### Expected Document State

**Recorded peer** — only the first message is capitalized:

```json
{
  "$tag": "app",
  "messages": {
    "$tag": "ul",
    "$items": ["Hello World", "gOOD mORning", "denICEk FORmative"]
  }
}
```

**Replay peer** — all messages are capitalized via wildcard replay:

```json
{
  "$tag": "app",
  "messages": {
    "$tag": "ul",
    "$items": ["Hello World", "Good Morning", "Denicek Formative"]
  }
}
```

---

## 2. Todo App — Recording and Replaying Multi-Step Actions

### Problem Description

A todo application with a text input (composer) and a list of items. The user
types a task name into the input and clicks an "Add" button. The button must:

1. Insert a new empty item at the front of the list.
2. Copy the current input value into the new item.

Rather than hard-coding this behavior, we **record** the two edits as replayable
steps stored in the document itself. When the button is "clicked" later, the
steps are replayed to produce a new item with the current input value.

This demonstrates the **self-describing document** pattern: UI behavior is
encoded as data within the CRDT document.

### Step-by-Step Walkthrough

1. **Initialize** the document with a composer (input + button) and a list with
   two existing items.
2. **Record the add sequence**: push a new empty item to the front of the list,
   then copy the input value into it.
3. **Store the event IDs** as replay steps inside the button's `steps` list.
4. **Verify** the document state — the first item should now contain the input
   value.
5. **Change the input** to a new task name.
6. **Replay the steps** — the button's recorded steps are re-executed, inserting
   another item with the new input value.

### Code

```typescript
import { Denicek } from "@mydenicek/core";

const peer = new Denicek("alice", {
  $tag: "app",
  composer: {
    $tag: "composer",
    input: { $tag: "input", value: "Review feedback" },
    addAction: {
      $tag: "button",
      steps: { $tag: "event-steps", $items: [] },
    },
  },
  items: {
    $tag: "ul",
    $items: [
      { $tag: "li", $items: ["Ship prototype"] },
      { $tag: "li", $items: ["Write paper"] },
    ],
  },
});

// Step 1: Record the two edits that make up "add item"
const insertItemEventId = peer.pushFront("items", {
  $tag: "li",
  $items: [""],
});
const copyInputEventId = peer.copy("items/!0/0", "composer/input/value");

// Step 2: Store event IDs as replay steps in the button
peer.pushBack("composer/addAction/steps", {
  $tag: "replay-step",
  eventId: insertItemEventId,
});
peer.pushBack("composer/addAction/steps", {
  $tag: "replay-step",
  eventId: copyInputEventId,
});
```

### Expected State After Recording

The first item now contains the copied input value ("Review feedback"):

```json
{
  "$tag": "app",
  "composer": {
    "$tag": "composer",
    "input": { "$tag": "input", "value": "Review feedback" },
    "addAction": {
      "$tag": "button",
      "steps": {
        "$tag": "event-steps",
        "$items": [
          { "$tag": "replay-step", "eventId": "alice:0" },
          { "$tag": "replay-step", "eventId": "alice:1" }
        ]
      }
    }
  },
  "items": {
    "$tag": "ul",
    "$items": [
      { "$tag": "li", "$items": ["Review feedback"] },
      { "$tag": "li", "$items": ["Ship prototype"] },
      { "$tag": "li", "$items": ["Write paper"] }
    ]
  }
}
```

### Replaying the Action

```typescript
// Change the input to a new task name
peer.set("composer/input/value", "Book venue");

// "Click" the button — replay the recorded steps
peer.repeatEditsFrom("composer/addAction/steps");
```

### Expected State After Replay

A new item "Book venue" is inserted at the front:

```json
{
  "$tag": "app",
  "composer": {
    "$tag": "composer",
    "input": { "$tag": "input", "value": "Book venue" },
    "addAction": {
      "$tag": "button",
      "steps": {
        "$tag": "event-steps",
        "$items": [
          { "$tag": "replay-step", "eventId": "alice:0" },
          { "$tag": "replay-step", "eventId": "alice:1" }
        ]
      }
    }
  },
  "items": {
    "$tag": "ul",
    "$items": [
      { "$tag": "li", "$items": ["Book venue"] },
      { "$tag": "li", "$items": ["Review feedback"] },
      { "$tag": "li", "$items": ["Ship prototype"] },
      { "$tag": "li", "$items": ["Write paper"] }
    ]
  }
}
```

---

## 3. Counter App — Structural Wrapping and Formula Trees

### Problem Description

A counter application where clicking a button increments a numeric value. The
value is not stored as a single mutable number — instead, each increment
**wraps** the current value into a formula tree node `{ left: <previous>,
right: 1 }`. The final value is computed by recursively evaluating the tree.

This demonstrates:

- **`wrapRecord`** — wrapping an existing node inside a new record.
- **`rename`** — renaming a field (the wrapped value becomes `left`).
- **`add`** — adding a new field (`right: 1`).
- **Structural stability** — the recorded steps continue to work correctly even
  after the formula node is itself wrapped inside another structural container.

### Step-by-Step Walkthrough

1. **Initialize** with a formula value of `1` and a button with empty steps.
2. **Record the increment sequence**: wrap `formula` into a record tagged
   `x-formula-plus`, rename the inner field to `left`, add `right: 1`.
3. **Store the three event IDs** as replay steps.
4. **Click the button** (replay) → formula becomes
   `{ left: { left: 1, right: 1 }, right: 1 }`, evaluating to 3.
5. **Wrap the formula inside a paragraph** (structural change to the container).
6. **Click again** → the replay still works, incrementing to 4.

### Code

```typescript
import { Denicek } from "@mydenicek/core";

const peer = new Denicek("alice", {
  $tag: "app",
  formula: 1,
  btn: {
    $tag: "button",
    label: "Add 1",
    script: {
      $tag: "replay-script",
      steps: { $tag: "event-steps", $items: [] },
    },
  },
});

// A recursive evaluator for the formula tree
type FormulaNode =
  | number
  | { $tag: "x-formula-plus"; left: FormulaNode; right: FormulaNode };

const evaluateFormula = (formula: FormulaNode): number =>
  typeof formula === "number"
    ? formula
    : evaluateFormula(formula.left) + evaluateFormula(formula.right);

// Record the three steps that make up "increment"
const wrapEventId = peer.wrapRecord("formula", "formula", "x-formula-plus");
const renameEventId = peer.rename("formula", "formula", "left");
const addRightEventId = peer.add("formula", "right", 1);

// Store as replay steps
peer.pushBack("btn/script/steps", {
  $tag: "replay-step",
  eventId: wrapEventId,
});
peer.pushBack("btn/script/steps", {
  $tag: "replay-step",
  eventId: renameEventId,
});
peer.pushBack("btn/script/steps", {
  $tag: "replay-step",
  eventId: addRightEventId,
});
```

### Expected State After Recording (value = 2)

```json
{
  "$tag": "app",
  "formula": {
    "$tag": "x-formula-plus",
    "left": 1,
    "right": 1
  },
  "btn": { "..." : "..." }
}
```

`evaluateFormula(formula)` → **2**

### After First Click (value = 3)

```typescript
peer.repeatEditsFrom("btn/script/steps");
```

```json
{
  "formula": {
    "$tag": "x-formula-plus",
    "left": {
      "$tag": "x-formula-plus",
      "left": 1,
      "right": 1
    },
    "right": 1
  }
}
```

`evaluateFormula(formula)` → **3**

### Structural Change + Second Click (value = 4)

```typescript
// Wrap the formula inside a "paragraph" container
peer.wrapRecord("formula", "math", "paragraph");

// Click the button again — replay still targets the formula correctly
peer.repeatEditsFrom("btn/script/steps");
```

The formula now lives at `formula.math`, but the replay steps adapt via
operational transformation:

```json
{
  "formula": {
    "$tag": "paragraph",
    "math": {
      "$tag": "x-formula-plus",
      "left": {
        "$tag": "x-formula-plus",
        "left": {
          "$tag": "x-formula-plus",
          "left": 1,
          "right": 1
        },
        "right": 1
      },
      "right": 1
    }
  }
}
```

`evaluateFormula(formula.math)` → **4**

---

## 4. Conference Speaker List — Concurrent Structural Transformation

### Problem Description

A conference management application where two peers collaborate on a speaker
list. **Alice** restructures the flat list into a table (wrapping each item into
a row, adding a computed name column). **Bob** concurrently adds a new speaker
using a recorded button action.

When the peers sync, the CRDT must merge Bob's new list item into Alice's
restructured table — a non-trivial concurrent structural transformation handled
by operational transformation on selectors.

### Step-by-Step Walkthrough

1. **Initialize** both peers with a toolbar (input + add-speaker button) and a
   flat speaker list.
2. **Alice records the "add speaker" action**: push a new empty speaker to the
   list, copy the input value into it. She stores these as replay steps, then
   removes the temporary item.
3. **Sync** Alice and Bob so both have the replay steps.
4. **Alice restructures the list into a table**: updates tags (`ul` → `table`,
   `li` → `td`), wraps each item into a `tr` row, adds a computed name column
   with a reference to the contact field.
5. **Bob adds a new speaker** by changing the input and replaying the button
   steps.
6. **Sync again** — the CRDT merges Bob's new speaker into Alice's table
   structure. Both peers converge to the same document.

### Code

```typescript
import { Denicek } from "@mydenicek/core";

const initialDocument = {
  $tag: "app",
  controls: {
    $tag: "toolbar",
    input: {
      $tag: "input",
      value: "Katherine Johnson, katherine@example.com",
    },
    addSpeakerFromInput: {
      $tag: "button",
      steps: { $tag: "event-steps", $items: [] },
    },
  },
  speakers: {
    $tag: "ul",
    $items: [
      { $tag: "li", contact: "Ada Lovelace, ada@example.com" },
      { $tag: "li", contact: "Grace Hopper, grace@example.com" },
    ],
  },
};

const alice = new Denicek("alice", initialDocument);
const bob = new Denicek("bob", initialDocument);

// Helper to sync two peers bidirectionally
function sync(a: Denicek, b: Denicek): void {
  const aFrontiers = a.frontiers;
  const bFrontiers = b.frontiers;
  for (const event of a.eventsSince(bFrontiers)) b.applyRemote(event);
  for (const event of b.eventsSince(aFrontiers)) a.applyRemote(event);
}

// Alice records the "add speaker from input" action
const insertSpeakerEventId = alice.pushBack("speakers", {
  $tag: "li",
  contact: "",
});
const copyInputEventId = alice.copy(
  "speakers/!2/contact",
  "controls/input/value",
);
alice.pushBack("controls/addSpeakerFromInput/steps", {
  $tag: "replay-step",
  eventId: insertSpeakerEventId,
});
alice.pushBack("controls/addSpeakerFromInput/steps", {
  $tag: "replay-step",
  eventId: copyInputEventId,
});
// Remove the temporary item used during recording
alice.popBack("speakers");

sync(alice, bob);

// Alice restructures the flat list into a table with computed name column
alice.updateTag("speakers", "table");
alice.updateTag("speakers/*", "td");
alice.wrapList("speakers/*", "tr");
alice.pushBack("speakers/*", {
  $tag: "td",
  name: {
    $tag: "split-first",
    source: { $ref: "../../../0/contact" },
    separator: ", ",
  },
});

// Concurrently, Bob adds a new speaker via the button
bob.set("controls/input/value", "Margaret Hamilton, margaret@example.com");
bob.repeatEditsFrom("controls/addSpeakerFromInput/steps");

// Sync — the CRDT merges Bob's addition into Alice's table structure
sync(alice, bob);
```

### Expected Converged State

Both Alice and Bob converge to:

```json
{
  "$tag": "app",
  "controls": {
    "$tag": "toolbar",
    "input": {
      "$tag": "input",
      "value": "Margaret Hamilton, margaret@example.com"
    },
    "addSpeakerFromInput": {
      "$tag": "button",
      "steps": {
        "$tag": "event-steps",
        "$items": [
          { "$tag": "replay-step", "eventId": "<insertSpeakerEventId>" },
          { "$tag": "replay-step", "eventId": "<copyInputEventId>" }
        ]
      }
    }
  },
  "speakers": {
    "$tag": "table",
    "$items": [
      {
        "$tag": "tr",
        "$items": [
          { "$tag": "td", "contact": "Ada Lovelace, ada@example.com" },
          {
            "$tag": "td",
            "name": {
              "$tag": "split-first",
              "source": { "$ref": "../../../0/contact" },
              "separator": ", "
            }
          }
        ]
      },
      {
        "$tag": "tr",
        "$items": [
          { "$tag": "td", "contact": "Grace Hopper, grace@example.com" },
          {
            "$tag": "td",
            "name": {
              "$tag": "split-first",
              "source": { "$ref": "../../../0/contact" },
              "separator": ", "
            }
          }
        ]
      },
      {
        "$tag": "tr",
        "$items": [
          {
            "$tag": "td",
            "contact": "Margaret Hamilton, margaret@example.com"
          },
          {
            "$tag": "td",
            "name": {
              "$tag": "split-first",
              "source": { "$ref": "../../../0/contact" },
              "separator": ", "
            }
          }
        ]
      }
    ]
  }
}
```

Key observations:

- Bob's new speaker ("Margaret Hamilton") was automatically wrapped into a `tr`
  row with a `td` cell and a computed name column — even though Bob never
  performed the table restructuring himself.
- The `$ref` references in the name column point to the sibling contact field
  using a relative path.
- Both peers agree on the exact same document.

---

## 5. Conference Budget — References, Structural Edits, and Computed Values

### Problem Description

A conference budget application where speaker fees are tracked in a list, and a
summary section holds a computed total. The total depends on **references**
(`$ref`) pointing to individual fee fields. When the list is restructured (e.g.,
items wrapped into table rows), the references must be **automatically
transformed** to remain valid.

This demonstrates:

- **References** (`$ref`) as first-class document nodes.
- **Reference path transformation** — when structural edits (like `wrapList`)
  change the tree shape, `$ref` paths are updated by the OT system.
- **Multi-peer convergence** with concurrent data edits and structural
  transformations.

### Step-by-Step Walkthrough

1. **Initialize** both peers with a speaker list and a summary containing
   `$ref`s to each speaker's fee.
2. **Alice** updates a speaker's fee from 200 to 250.
3. **Bob** restructures the list into a table (updates tags, wraps items into
   rows).
4. **Sync** — both peers converge. The `$ref` paths in the summary are
   automatically updated to account for the new table structure.
5. **Both peers compute the total** by resolving references and summing fees.

### Code

```typescript
import { Denicek } from "@mydenicek/core";

const initialDocument = {
  $tag: "app",
  speakers: {
    $tag: "ul",
    $items: [
      { $tag: "speaker", name: "Ada Lovelace", fee: 100 },
      { $tag: "speaker", name: "Grace Hopper", fee: 200 },
    ],
  },
  summary: {
    $tag: "budget",
    total: 0,
    dependsOn: {
      $tag: "refs",
      $items: [
        { $ref: "/speakers/0/fee" },
        { $ref: "/speakers/1/fee" },
      ],
    },
  },
};

const alice = new Denicek("alice", initialDocument);
const bob = new Denicek("bob", initialDocument);

// Alice updates Grace Hopper's fee
alice.set("speakers/1/fee", 250);

// Bob restructures into a table
bob.updateTag("speakers", "table");
bob.updateTag("speakers/*", "td");
bob.wrapList("speakers/*", "tr");

// Sync peers
const aliceFrontiers = alice.frontiers;
const bobFrontiers = bob.frontiers;
for (const event of alice.eventsSince(bobFrontiers)) bob.applyRemote(event);
for (const event of bob.eventsSince(aliceFrontiers)) alice.applyRemote(event);

// Both peers compute the total by resolving $ref paths
// (application-level logic, not part of the CRDT)
```

### Expected Converged State

```json
{
  "$tag": "app",
  "speakers": {
    "$tag": "table",
    "$items": [
      {
        "$tag": "tr",
        "$items": [{ "$tag": "td", "name": "Ada Lovelace", "fee": 100 }]
      },
      {
        "$tag": "tr",
        "$items": [{ "$tag": "td", "name": "Grace Hopper", "fee": 250 }]
      }
    ]
  },
  "summary": {
    "$tag": "budget",
    "total": 350,
    "dependsOn": {
      "$tag": "refs",
      "$items": [
        { "$ref": "/speakers/0/*/fee" },
        { "$ref": "/speakers/1/*/fee" }
      ]
    }
  }
}
```

Key observations:

- The `$ref` paths changed from `/speakers/0/fee` to `/speakers/0/*/fee`. The
  `*` wildcard was inserted automatically by the OT system because `wrapList`
  added an intermediate list level (the `tr` row's `$items` array).
- Alice's fee update (200 → 250) merged cleanly with Bob's structural
  transformation.
- Both peers compute the same total of **350** (100 + 250).

---

## 6. Traffic Accidents — References, Computed Statistics, and Linked Formulas

### Problem Description

A data analysis application tracking traffic accident records from two regions
(north and south). Each region has a list of accidents with injury counts. A
statistics section contains two formula nodes: `primary` filters the north
dataset by a minimum injury threshold, and `secondary` mirrors the primary's
threshold via a `$ref` but applies it to the south dataset.

This demonstrates:

- **Copy** — duplicating a formula node to create a second statistic.
- **References between formulas** — the secondary statistic's `minInjuries`
  field is a `$ref` pointing to the primary's `minInjuries`, creating a linked
  dependency.
- **Computed values** — application-level logic resolves references and
  recomputes results.
- **Cascading updates** — changing the primary threshold automatically affects
  the secondary statistic through the reference.

### Step-by-Step Walkthrough

1. **Initialize** with two data sources (north: 3 accidents, south: 2 accidents)
   and two formula placeholders.
2. **Copy** the primary formula to the secondary slot, then replace the
   secondary's `source` reference to point to the south dataset and its
   `minInjuries` to be a `$ref` to the primary's threshold.
3. **Compute results**: primary filters north accidents with injuries ≥ 3
   (result: 2), secondary filters south accidents with injuries ≥ 3 (result: 1).
4. **Lower the threshold** to 2 on the primary. Recompute both: primary still
   finds 2 (injuries 3 and 4), secondary now finds 2 (injuries 2 and 5) because
   the linked `$ref` resolves to the updated threshold.

### Code

```typescript
import { Denicek } from "@mydenicek/core";

const peer = new Denicek("alice", {
  $tag: "app",
  dataSources: {
    $tag: "sources",
    north: {
      $tag: "rows",
      $items: [
        { $tag: "accident", injuries: 1 },
        { $tag: "accident", injuries: 3 },
        { $tag: "accident", injuries: 4 },
      ],
    },
    south: {
      $tag: "rows",
      $items: [
        { $tag: "accident", injuries: 2 },
        { $tag: "accident", injuries: 5 },
      ],
    },
  },
  stats: {
    $tag: "stats",
    primary: {
      $tag: "formula",
      source: { $ref: "/dataSources/north" },
      minInjuries: 3,
      result: 0,
    },
    secondary: {
      $tag: "formula",
      source: { $ref: "/dataSources/south" },
      minInjuries: 0,
      result: 0,
    },
  },
});

// Copy the primary formula structure into secondary, then customize it
peer.copy("stats/secondary", "stats/primary");
peer.delete("stats/secondary", "source");
peer.add("stats/secondary", "source", { $ref: "/dataSources/south" });
peer.delete("stats/secondary", "minInjuries");
peer.add("stats/secondary", "minInjuries", {
  $ref: "/stats/primary/minInjuries",
});

// Application-level logic to compute the statistic result
// (resolves $ref paths and filters rows by threshold)
// After computing: primary.result = 2, secondary.result = 1
```

### Expected State After First Computation (threshold = 3)

```json
{
  "$tag": "app",
  "dataSources": {
    "$tag": "sources",
    "north": {
      "$tag": "rows",
      "$items": [
        { "$tag": "accident", "injuries": 1 },
        { "$tag": "accident", "injuries": 3 },
        { "$tag": "accident", "injuries": 4 }
      ]
    },
    "south": {
      "$tag": "rows",
      "$items": [
        { "$tag": "accident", "injuries": 2 },
        { "$tag": "accident", "injuries": 5 }
      ]
    }
  },
  "stats": {
    "$tag": "stats",
    "primary": {
      "$tag": "formula",
      "source": { "$ref": "/dataSources/north" },
      "minInjuries": 3,
      "result": 2
    },
    "secondary": {
      "$tag": "formula",
      "source": { "$ref": "/dataSources/south" },
      "minInjuries": { "$ref": "/stats/primary/minInjuries" },
      "result": 1
    }
  }
}
```

- **Primary**: north accidents with injuries ≥ 3 → injuries 3 and 4 → **result:
  2**.
- **Secondary**: south accidents with injuries ≥ 3 (resolved via `$ref` to
  primary's threshold) → only injuries 5 → **result: 1**.

### After Lowering the Threshold (threshold = 2)

```typescript
peer.set("stats/primary/minInjuries", 2);
// Recompute both statistics...
```

```json
{
  "stats": {
    "$tag": "stats",
    "primary": {
      "$tag": "formula",
      "source": { "$ref": "/dataSources/north" },
      "minInjuries": 2,
      "result": 2
    },
    "secondary": {
      "$tag": "formula",
      "source": { "$ref": "/dataSources/south" },
      "minInjuries": { "$ref": "/stats/primary/minInjuries" },
      "result": 2
    }
  }
}
```

- **Primary**: north accidents with injuries ≥ 2 → injuries 3 and 4 → **result:
  2** (unchanged — no north accident has exactly 2 injuries).
- **Secondary**: south accidents with injuries ≥ 2 (the `$ref` now resolves to
  2) → injuries 2 and 5 → **result: 2** (increased from 1).

---

## Summary of Demonstrated Capabilities

| Example              | Key Features                                                          |
| -------------------- | --------------------------------------------------------------------- |
| Hello World          | Custom primitive edits, wildcard replay (`*`)                         |
| Todo App             | Multi-step action recording, `pushFront`, `copy`, `repeatEditsFrom`   |
| Counter App          | `wrapRecord`, `rename`, `add`, structural stability across replays    |
| Conference List      | Two-peer sync, concurrent structural transform + item insertion       |
| Conference Budget    | `$ref` references, automatic path transformation under `wrapList`     |
| Traffic Accidents    | `copy`, inter-formula `$ref` linking, cascading computed updates      |
