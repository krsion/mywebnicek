# User Manual

**Project**: MyDenicek — Local-first Collaborative Document Editor
**Author**: Bc. Ondřej Krsička
**Supervisor**: Mgr. Tomáš Petříček, Ph.D.

---

## 1. Introduction

MyDenicek is a local-first collaborative document editor for structured, tree-based documents. It allows you to build and edit documents composed of nested HTML-like elements, text values, formulas, references, and programmable action buttons — all synchronized in real time between collaborators using CRDTs (Conflict-free Replicated Data Types).

Key features:

- **Tree-based editing** — Documents are structured as a tree of typed nodes (elements, values, formulas, references, and actions).
- **Real-time collaboration** — Multiple users can edit the same document simultaneously; changes sync automatically via WebSocket.
- **Local-first** — The document works offline and synchronizes when connectivity is restored.
- **Programming by demonstration** — Record your editing actions, then replay them elsewhere or save them as reusable buttons.
- **Live formulas** — Compute values from other nodes using built-in string, math, and array operations.

---

## 2. Getting Started

### 2.1 Accessing the Live Demo

Open the live demo in your browser:

> **<https://krsion.github.io/MyDenicek/>**

No installation is required. The application runs entirely in the browser and automatically connects to the sync server for collaboration.

### 2.2 Running Locally

If you want to run the application on your own machine:

**Prerequisites:**
- [Node.js](https://nodejs.org/) (version 18 or later)
- npm (included with Node.js)

**Steps:**

1. Clone the repository:
   ```bash
   git clone https://github.com/krsion/MyDenicek.git
   cd MyDenicek
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server (launches both the sync server and web app):
   ```bash
   npm run dev
   ```
4. Open your browser at **http://localhost:5174**.

You can also run only specific parts:
- `npm run dev -w mywebnicek` — Web app only (no sync server)
- `npm run dev -w @mydenicek/sync-server` — Sync server only (port 3001)

### 2.3 Interface Overview

The interface is divided into two main areas:

```
┌─────────────────────────────────┬─────────────────────────┐
│         Main Toolbar            │                         │
├─────────────────────────────────┤   Recorded History      │
│    Navigation Bar               │   (Actions Panel)       │
├─────────────────────────────────┤                         │
│                                 │   - List of recorded    │
│    Document View                │     editing actions     │
│    (Rendered Document)          │   - Replay controls     │
│                                 │   - "Add to Button"     │
│                                 │                         │
├─────────────────────────────────┤                         │
│    Element Details Panel        │                         │
└─────────────────────────────────┴─────────────────────────┘
```

- **Main Toolbar** (top) — Undo/Redo, Add child, Rename/Edit, Copy/Paste, Delete, Formula toggle, Sync controls, Share, and panel toggles.
- **Navigation Bar** — Buttons for traversing the tree (Parent, First child, Prev sibling, Next sibling, Clear) and reordering nodes (Move ↑, Move ↓).
- **Document View** (center) — The rendered document. Click on any element to select it. The selected node is highlighted with a blue overlay.
- **Element Details** (bottom) — Shows properties of the selected node: tag name, GUID, CSS classes, dimensions, value, and an editable attribute table.
- **Recorded History / Actions Panel** (right side, resizable) — Shows all editing actions you have performed since the session started. Used for recording and replay.

---

## 3. Document Structure

### 3.1 Node Types

Every document is a tree. Each node in the tree is one of five types:

#### Element Nodes

Structural nodes that correspond to HTML tags (e.g., `<div>`, `<article>`, `<table>`, `<ul>`). Element nodes can have:
- A **tag name** (e.g., `section`, `p`, `h1`)
- **Attributes** (e.g., `style`, `className`)
- **Child nodes** of any type

Element nodes are the building blocks of your document's structure.

#### Value Nodes

Leaf nodes containing text or numeric content. A value node holds a single string (e.g., `"Hello World"` or `"42"`). Value nodes cannot have children.

#### Formula Nodes

Nodes that compute a result from their inputs. A formula node has an **operation** (e.g., `add`, `concat`, `upperText`) and takes its arguments either from child nodes or in RPN (Reverse Polish Notation) style from preceding siblings. See [Section 8.1](#81-formulas) for details.

#### Reference Nodes

Nodes that point to another node's value. A reference node displays the current value of its target node. If the target value changes, the reference automatically updates. References are shown with an arrow indicator (→) and can be clicked to navigate to the target.

#### Action Nodes

Programmable buttons. An action node has a **label** (displayed on the button), a list of **actions** (recorded editing operations), and optional **parameters** (named node references). Clicking the button replays its stored actions. See [Section 7](#7-recording--replay) for how to create action buttons.

### 3.2 Tree Navigation

You can navigate the document tree in several ways:

**By clicking:**
- **Click** on any rendered element to select it. A blue highlight overlay appears around it.
- **Ctrl+Click** to toggle multi-selection (add/remove individual nodes).
- **Shift+Click** to select a range of sibling nodes.

**By keyboard (when the document view is focused):**
- **Arrow Up** — Navigate to the parent node
- **Arrow Down** — Navigate to the first child node
- **Arrow Left** — Navigate to the previous sibling
- **Arrow Right** — Navigate to the next sibling
- **Escape** — Clear the selection

**Using the Navigation Bar:**
The bar below the toolbar provides clickable buttons:
- **Parent** — Go to the parent of the selected node
- **First child** — Go to the first child
- **Prev sibling / Next sibling** — Navigate among siblings
- **Esc (Clear)** — Deselect everything
- **Move ↑ / Move ↓** — Reorder the selected node among its siblings

---

## 4. Editing Documents

### 4.1 Creating Nodes

To add a new node to the document:

1. **Select a parent node** — Click on the element where you want to add a child.
2. **Click the Add (+) button** in the toolbar.
3. **Choose the node type** from the radio buttons:
   - **Tag** — Creates an element node. Enter a valid HTML tag name (e.g., `div`, `p`, `h2`).
   - **Value** — Creates a text value node. Enter the text content (can be empty).
   - **Action** — Creates a programmable button. Enter the button's label.
   - **Formula** — Creates a formula node. Select an operation from the dropdown.
   - **Ref** — Creates a reference node. Click "Pick target from document..." and then click on the node you want to reference.
4. **Press Add** or hit **Enter** to create the node.

The newly created node is automatically selected.

> **Note:** You can only add children to element and formula nodes. Value, reference, and action nodes are leaf nodes.

### 4.2 Editing Properties

#### Renaming Element Tags

1. Select an element node.
2. Click the **Rename** button in the toolbar.
3. Enter the new tag name and press **Enter**.

Tag names are automatically lowercased and validated (must start with a letter, contain only letters, digits, or hyphens).

#### Editing Text Values

1. Select a value node.
2. Click the **Edit** button in the toolbar (replaces the Rename button when a value node is selected).
3. Modify the text and press **Enter**.

For `<input>` elements in the rendered document, you can type directly into the input field — changes are saved automatically.

#### Editing Attributes

When an element node is selected, the **Element Details** panel at the bottom shows its attributes in an editable table.

- **Edit an attribute** — Click on the value field, type a new value, and press **Enter**.
- **Delete an attribute** — Click the trash icon (🗑) next to the attribute.
- **Add an attribute** — Fill in the "New key" and "New value" fields at the bottom of the table and click the (+) button.

The `style` attribute accepts JSON objects (e.g., `{"color": "red", "fontSize": "16px"}`).

### 4.3 Deleting Nodes

1. Select one or more nodes (use Ctrl+Click for multi-selection).
2. Click the **Delete** (🗑) button in the toolbar.
3. A confirmation dialog appears: "Delete N node(s)? This action can be undone with Ctrl+Z."
4. Click **Delete** to confirm.

> **Note:** You cannot delete the root node.

### 4.4 Moving Nodes (Cut/Paste)

To move a node to a different location in the tree:

1. **Select the node(s)** you want to move.
2. Press **Ctrl+X** to cut. A blue banner appears: "N node(s) cut. Select target and press Ctrl+V to paste."
3. **Click on the target element** where you want to move the node(s) (must be an element node).
4. Press **Ctrl+V** to paste. The node(s) move to become children of the target.
5. Press **Escape** to cancel the cut operation.

You can also **reorder nodes among siblings** using the **Move ↑** and **Move ↓** buttons in the navigation bar.

### 4.5 Copying Nodes

To copy a value node:

1. **Select a value node**.
2. Press **Ctrl+C** or click the **Copy** button in the toolbar.
3. **Select the target** — either a value node (to replace it) or an element node (to add as a child).
4. Press **Ctrl+V** or click the **Paste** button.

The copy creates a new node linked to the original source via a `sourceId`, so the recording system can track provenance.

---

## 5. Undo & Redo

MyDenicek supports full undo and redo:

- **Undo**: Click the ↶ button in the toolbar or press **Ctrl+Z**.
- **Redo**: Click the ↷ button in the toolbar or press **Ctrl+Y**.

Changes made within a short time window (approximately 1 second) are grouped into a single undo step, so rapid edits are undone together.

Up to 100 undo steps are stored. Undo only affects your own local changes — it does not undo edits made by collaborators.

---

## 6. Collaborative Editing

### 6.1 Connecting to a Sync Server

MyDenicek automatically connects to the sync server when you open the application. The connection status is shown in the top-right of the toolbar:

- **Synced** (green badge) — Connected and synchronized. Shows round-trip latency (e.g., "Synced (42ms)").
- **Connecting** (yellow badge with spinner) — Connection attempt in progress.
- **Disconnected** (red badge) — Connection lost. The app will auto-retry.
- **Offline** (gray badge) — Sync is turned off.

You can toggle sync on/off using the **switch** next to the status indicator.

### 6.2 Sharing and Real-time Collaboration

Each document session has a unique **room ID** embedded in the URL hash (e.g., `https://krsion.github.io/MyDenicek/#abc12345`).

To collaborate:
1. Click the **Share** button in the toolbar — the URL is copied to your clipboard.
2. Send this link to your collaborators.
3. When they open the link, they automatically join the same room and see the same document.

You can also set a **display name** by clicking the person icon (👤) in the toolbar. This name is visible to other collaborators.

Changes are synchronized in real time. When a collaborator selects a node, you can see their selection highlighted with a distinct color overlay.

### 6.3 Conflict Resolution

Because MyDenicek uses CRDTs (specifically the Loro library), conflicts are resolved automatically and deterministically. All peers converge to the same document state regardless of the order in which they receive changes.

Specific resolution behaviors:

| Concurrent Operations | What Happens |
|---|---|
| Two users rename the same tag | One wins (last-writer-wins) |
| Two users edit the same value | One wins (last-writer-wins) |
| Two users add children to the same parent | Both children are added |
| Two users move the same node | One move wins (last-writer-wins) |
| One user moves, another deletes | Delete wins — the node is removed |
| Two users delete the same node | Node is deleted (idempotent) |

---

## 7. Recording & Replay

MyDenicek records every editing action you perform and displays them in the **Actions Panel** on the right side of the screen. This enables **programming by demonstration** — you can replay recorded actions to automate repetitive edits.

### 7.1 How Recording Works

Every change you make to the document is automatically recorded as a patch in the Actions Panel:

- **Tree patches** — Creating, deleting, or moving nodes.
- **Map patches** — Changing attributes, tags, or properties.
- **Text patches** — Editing text values.

Each recorded action shows a human-readable description like "create `<tr>` in ..." or "set style on ..." along with clickable node references.

### 7.2 Replaying Actions

To replay recorded actions:

1. **Select the actions** you want to replay by checking their checkboxes in the Actions Panel. Use "Select all" to select everything, or pick individual actions.
2. **Select a target node** in the document — this is where the replayed actions will be applied.
3. Click **Apply** (or "Apply (N)" if specific actions are selected).

The system **generalizes** the recorded actions before replay:
- Nodes that were created during the recorded session are replaced with placeholder variables (`$1`, `$2`, etc.).
- The target node you select becomes the starting point for the replayed actions.

This means you can perform a set of edits on one part of the document, then replay them on a different part.

**Retargeting node references:**
In the Actions Panel, each node reference has a small target icon (🎯). Click it to replace that reference with the currently selected node. This lets you adjust which nodes the replayed actions will affect.

### 7.3 Programming Action Buttons

You can save recorded actions as reusable **action buttons** embedded in the document:

1. First, create an action node (via **Add → Action**) and give it a label.
2. Perform the editing actions you want to automate.
3. In the Actions Panel, select the recorded actions with the checkboxes.
4. Click **Add to Button**.
5. In the dialog:
   - Choose which action button to add the actions to.
   - **Configure parameters**: For each referenced node, you can name it as a parameter (e.g., `target`) or mark it as "Fixed" (hardcoded). Parameters become clickable prompts when the button is used.
6. Click **Add**.

**Using an action button:**
- Click the button in the rendered document.
- If the button has parameters, a yellow banner prompts you to click on a node for each parameter (e.g., "Click a node to set as $target").
- Once all parameters are provided, the actions execute.

**Viewing and editing button actions:**
- Select an action node to see its stored actions in the Actions Panel (they appear in a pinned section at the top).
- You can delete individual actions from a button using the trash icon.

### 7.4 Clearing the Recording History

Click the stop (■) icon at the top of the Actions Panel to clear all recorded history and start fresh.

---

## 8. Advanced Features

### 8.1 Formulas

Formula nodes compute values from their inputs using built-in operations. There are two styles:

**Child-based formulas:** The formula takes its children as arguments.
- Create a formula node as a parent, then add value or reference nodes as its children.
- In formula view mode, it displays as `operation(arg1, arg2, ...)`.
- In result view mode, it displays the computed value.

**RPN (Reverse Polish Notation) formulas:** Childless formula nodes that consume their preceding siblings as arguments.
- Place value or reference nodes as siblings, followed by the formula node.
- The formula pops the required number of arguments from the preceding siblings.
- This enables stack-based composition (e.g., `5`, `3`, `add` produces `8`).

**Available operations:**

| Category | Operations |
|---|---|
| **String** | `lowerText`, `upperText`, `capitalize`, `concat` (variadic), `trim`, `length`, `replace` (3 args) |
| **Math** | `add`, `subtract`, `divide`, `product` (variadic), `mod`, `round`, `floor`, `ceil`, `abs` |
| **Array** | `atIndex`, `splitString`, `arrayLength` |
| **Tree** | `countChildren` |

**Editing a formula's operation:** Select a formula node and use the dropdown in the toolbar to change the operation. An arity indicator shows whether the formula has the correct number of arguments (e.g., "2/2" means 2 children out of 2 expected).

**Toggling formula view:** Click the **Calculator** (🧮) button in the toolbar to toggle between:
- **Results** mode — Shows computed values.
- **Formulas** mode — Shows the formula structure with operation names and arguments.

Errors display with a red background (e.g., `#ERR: division by zero`).

### 8.2 JSON View

Click the **Raw** button in the toolbar to open a dialog showing the complete document state as raw JSON. This is useful for debugging and inspecting the internal CRDT structure.

### 8.3 Snapshots

Click the **Snapshot** (📷) button in the toolbar to capture a snapshot of the current document state. This creates a frozen copy that can be compared against future changes. You can filter the snapshot view by the current selection and toggle between table and JSON display.

### 8.4 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Ctrl+X** | Cut selected node(s) for move |
| **Ctrl+V** | Paste — move cut nodes to selected target, or paste copied value |
| **Ctrl+C** | Copy selected value node |
| **Escape** | Cancel cut operation / clear selection |
| **Arrow Up** | Navigate to parent node |
| **Arrow Down** | Navigate to first child |
| **Arrow Left** | Navigate to previous sibling |
| **Arrow Right** | Navigate to next sibling |
| **Ctrl+Click** | Toggle node in multi-selection |
| **Shift+Click** | Select range of siblings |

---

## 9. Troubleshooting

### The document is empty when I open a shared link

When joining an existing room via a shared link, the app waits up to 1 second for the sync server to deliver the document. If the connection is slow, the app may initialize with a blank document. Try refreshing the page.

### Changes are not syncing

- Check the status indicator in the top-right corner. If it says "Offline" or "Disconnected", toggle the sync switch off and on.
- Ensure you and your collaborator are using the same URL (same room ID in the hash).
- The sync server at `wss://mydenicek-sync-prod.azurewebsites.net` must be reachable. Corporate firewalls may block WebSocket connections.

### Undo doesn't revert a collaborator's change

Undo only affects your own local changes. It does not undo edits made by other peers. This is by design — each user's undo history is independent.

### A formula shows #ERR

Common causes:
- **Wrong number of arguments** — Check the arity indicator in the toolbar (e.g., "1/2" means 1 child but 2 expected).
- **Type mismatch** — Math operations require numbers; string operations require strings. Values like `"abc"` cannot be used with `add`.
- **Division by zero** — The `divide` operation returns `#ERR: division by zero` if the second argument is 0.

### An action button does nothing when clicked

- The button may have no actions assigned. Select it and check the Actions Panel for its stored actions.
- If the button has parameters, look for a yellow prompt banner asking you to click on nodes for each parameter.

### The document looks broken or elements are misplaced

- Try toggling between **Results** and **Formulas** view mode to see if formula evaluation is causing the issue.
- Check the **Element Details** panel for unexpected attributes (especially `style`).
- Use the **Raw** (JSON) view to inspect the raw document structure.

### I accidentally deleted something

Press **Ctrl+Z** immediately to undo the deletion. Up to 100 undo steps are available.
