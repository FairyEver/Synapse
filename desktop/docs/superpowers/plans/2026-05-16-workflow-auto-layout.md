# Workflow Canvas Auto-Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click auto-layout feature to the workflow editor canvas that arranges nodes left-to-right using Dagre.

**Architecture:** A pure function `autoLayout()` in a new module takes XYFlow nodes/edges, runs Dagre layout, and returns nodes with updated positions. The canvas component calls it from a new right-click menu item, then updates state and fits the view.

**Tech Stack:** `@dagrejs/dagre` for DAG layout, `@xyflow/react` (existing)

---

### Task 1: Install @dagrejs/dagre dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm add @dagrejs/dagre
```

- [ ] **Step 2: Install type definitions**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm add -D @types/dagre
```

- [ ] **Step 3: Verify installation**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && node -e "require('@dagrejs/dagre')"
```
Expected: No error output

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(workflow): add @dagrejs/dagre for auto-layout"
```

---

### Task 2: Create auto-layout pure function

**Files:**
- Create: `src/modules/workflow/editor/auto-layout.ts`
- Create: `src/modules/workflow/editor/__tests__/auto-layout.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/modules/workflow/editor/__tests__/auto-layout.test.ts
import { describe, it, expect } from "vitest"
import { autoLayout } from "../auto-layout"
import type { Node, Edge } from "@xyflow/react"

function makeNode(id: string, type: string, x = 0, y = 0, width = 200, height = 80): Node {
  return {
    id,
    type,
    position: { x, y },
    data: {},
    measured: { width, height },
  }
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

describe("autoLayout", () => {
  it("arranges a linear chain left-to-right", () => {
    const nodes = [
      makeNode("a", "prompt", 0, 0),
      makeNode("b", "prompt", 0, 0),
      makeNode("end", "end", 0, 0, 100, 40),
    ]
    const edges = [
      makeEdge("e1", "a", "b"),
      makeEdge("e2", "b", "end"),
    ]

    const result = autoLayout(nodes, edges)

    // Node "a" should be leftmost
    expect(result.find((n) => n.id === "a")!.position.x).toBeLessThan(
      result.find((n) => n.id === "b")!.position.x,
    )
    // Node "b" should be left of "end"
    expect(result.find((n) => n.id === "b")!.position.x).toBeLessThan(
      result.find((n) => n.id === "end")!.position.x,
    )
  })

  it("handles a branching graph without overlap", () => {
    const nodes = [
      makeNode("start", "prompt", 0, 0),
      makeNode("branch1", "prompt", 0, 0),
      makeNode("branch2", "prompt", 0, 0),
      makeNode("end", "end", 0, 0, 100, 40),
    ]
    const edges = [
      makeEdge("e1", "start", "branch1"),
      makeEdge("e2", "start", "branch2"),
      makeEdge("e3", "branch1", "end"),
      makeEdge("e4", "branch2", "end"),
    ]

    const result = autoLayout(nodes, edges)

    const b1 = result.find((n) => n.id === "branch1")!
    const b2 = result.find((n) => n.id === "branch2")!
    // branch1 and branch2 should have different y positions (same rank, separated vertically)
    expect(b1.position.y).not.toEqual(b2.position.y)
  })

  it("returns nodes unchanged when there is only one node", () => {
    const nodes = [makeNode("end", "end", 300, 200, 100, 40)]
    const edges: Edge[] = []

    const result = autoLayout(nodes, edges)

    expect(result).toHaveLength(1)
    // Single node still gets a position from dagre (centered)
    expect(result[0].position).toBeDefined()
  })

  it("uses fallback dimensions when node.measured is undefined", () => {
    const nodes: Node[] = [
      { id: "a", type: "prompt", position: { x: 0, y: 0 }, data: {} },
      { id: "end", type: "end", position: { x: 0, y: 0 }, data: {} },
    ]
    const edges = [makeEdge("e1", "a", "end")]

    const result = autoLayout(nodes, edges)

    expect(result.find((n) => n.id === "a")!.position.x).toBeLessThan(
      result.find((n) => n.id === "end")!.position.x,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run src/modules/workflow/editor/__tests__/auto-layout.test.ts
```
Expected: FAIL — module `../auto-layout` not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/modules/workflow/editor/auto-layout.ts
import dagre from "@dagrejs/dagre"
import type { Node, Edge } from "@xyflow/react"

const FALLBACK_DIMENSIONS: Record<string, { width: number; height: number }> = {
  prompt: { width: 200, height: 80 },
  switch: { width: 200, height: 80 },
  end: { width: 100, height: 40 },
}

const DEFAULT_DIMENSION = { width: 200, height: 80 }

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 })

  for (const node of nodes) {
    const measured = node.measured as { width?: number; height?: number } | undefined
    const fallback = FALLBACK_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSION
    const width = measured?.width ?? fallback.width
    const height = measured?.height ?? fallback.height
    g.setNode(node.id, { width, height })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    const measured = node.measured as { width?: number; height?: number } | undefined
    const fallback = FALLBACK_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSION
    const width = measured?.width ?? fallback.width
    const height = measured?.height ?? fallback.height
    return {
      ...node,
      position: {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
      },
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run src/modules/workflow/editor/__tests__/auto-layout.test.ts
```
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/workflow/editor/auto-layout.ts src/modules/workflow/editor/__tests__/auto-layout.test.ts
git commit -m "feat(workflow): add autoLayout pure function using dagre"
```

---

### Task 3: Integrate auto-layout into canvas context menu

**Files:**
- Modify: `src/modules/workflow/editor/canvas.tsx`

- [ ] **Step 1: Add import for autoLayout and LayoutGrid icon**

At the top of `canvas.tsx`, add:
```typescript
import { Clipboard, LayoutGrid } from "lucide-react"
import { autoLayout } from "./auto-layout"
```

(Replace the existing `import { Clipboard } from "lucide-react"` line.)

- [ ] **Step 2: Add the auto-layout handler**

Inside `CanvasContent`, after the `closePaneMenu` callback (around line 473), add:

```typescript
  const { fitView } = useReactFlow()

  const handleAutoLayout = useCallback(() => {
    const layoutedNodes = autoLayout(nodesRef.current, edges)
    setNodes(layoutedNodes)
    const wfNodes: WorkflowNode[] = layoutedNodes.map(flowNodeToWorkflowNode)
    const newDef = { ...definitionRef.current, nodes: wfNodes }
    definitionRef.current = newDef
    onChange(newDef)
    setPaneMenu(null)
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.1 })
    })
  }, [edges, onChange, setNodes, fitView])
```

Note: `fitView` needs to be destructured from `useReactFlow()`. The existing code already destructures `screenToFlowPosition` from it — update that line to also include `fitView`:

```typescript
  const { screenToFlowPosition, fitView } = useReactFlow()
```

- [ ] **Step 3: Add the menu item in the pane context menu**

In the JSX, after the existing "粘贴" button and before the closing `</div>` of the menu, add a separator and the auto-layout button:

```tsx
            <div className="my-1 h-px bg-border" />
            <button
              className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
              onClick={handleAutoLayout}
            >
              <LayoutGrid className="size-4" />
              自动布局
            </button>
```

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```
Expected: No errors

- [ ] **Step 5: Run all workflow editor tests**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run src/modules/workflow/editor/
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): add auto-layout to canvas right-click menu"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Start dev server**

Run:
```bash
cd /Users/liyang/Documents/code/github/Synapse && pnpm dev
```

- [ ] **Step 2: Test auto-layout**

1. Open the workflow editor
2. Create or open a workflow with multiple nodes (at least one switch node with branches)
3. Drag nodes to random positions
4. Right-click on canvas blank area
5. Verify menu shows "粘贴" and "自动布局"
6. Click "自动布局"
7. Verify: nodes rearrange left-to-right, no overlap, view fits all nodes
8. Verify: the editor shows unsaved state (dirty indicator)
9. Save and reopen — positions should persist

- [ ] **Step 3: Test edge cases**

1. Single-node workflow (just End): auto-layout should not crash
2. Disconnected nodes: should still layout without error
3. Large workflow: verify no performance issues
