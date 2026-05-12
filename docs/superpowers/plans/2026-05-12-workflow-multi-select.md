# Workflow Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable box-selection (drag-to-select) on the workflow editor canvas so users can select multiple nodes and batch-move/delete/copy/disconnect them.

**Architecture:** Add React Flow's native `selectionOnDrag` + `SelectionMode.Partial` to the `<ReactFlow>` component. Replace the current `onNodeClick`-driven selection sync with a `useOnSelectionChange` hook that correctly handles both single and multi-select. Pass `runState` into the canvas so `onNodeClick` only fires selection logic during run-state viewing.

**Tech Stack:** @xyflow/react ^12.10.2, React, TypeScript

**Spec:** `docs/superpowers/specs/2026-05-12-workflow-multi-select-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/src/modules/workflow/editor/canvas.tsx` | Modify | Add selection props, `SelectionSync` component, update `onNodeClick`, accept `runState` prop |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Modify | Pass `runState` to `WorkflowCanvas` |

No new files. No changes to `canvas-context.ts`, `node-context-menu.tsx`, `node-wrappers.tsx`, `node-config-panel.tsx`, or `toolbar.tsx`.

---

### Task 1: Add selectionOnDrag and SelectionMode to ReactFlow

**Files:**
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:3-20` (imports)
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:309-315` (ReactFlow props)

- [ ] **Step 1: Add `SelectionMode` and `useOnSelectionChange` to the import block**

In `desktop/src/modules/workflow/editor/canvas.tsx`, update the `@xyflow/react` import:

```tsx
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useOnSelectionChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"
```

- [ ] **Step 2: Add `selectionOnDrag` and `selectionMode` props to `<ReactFlow>`**

Change the `<ReactFlow>` JSX (line ~309-315) from:

```tsx
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeDragStop={onNodeDragStop}
          onDrop={onDrop} onDragOver={onDragOver}
          onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          edgeTypes={edgeTypes}
          fitView panOnScroll panOnScrollMode={PanOnScrollMode.Free}>
```

to:

```tsx
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeDragStop={onNodeDragStop}
          onDrop={onDrop} onDragOver={onDragOver}
          onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          edgeTypes={edgeTypes}
          selectionOnDrag selectionMode={SelectionMode.Partial}
          fitView panOnScroll panOnScrollMode={PanOnScrollMode.Free}>
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): enable box selection with selectionOnDrag"
```

---

### Task 2: Add SelectionSync and rewire selection state

**Files:**
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:83-89` (WorkflowCanvasProps)
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:91-92` (CanvasContent signature)
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:204-210` (onNodeClick, onPaneClick)
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:306-321` (return JSX — add SelectionSync, remove onPaneClick)

- [ ] **Step 1: Add `runState` to `WorkflowCanvasProps`**

Change `WorkflowCanvasProps` (line ~83-89) from:

```tsx
interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  nodeResults?: Record<string, NodeRunResult>
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}
```

to:

```tsx
interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  nodeResults?: Record<string, NodeRunResult>
  runState?: string
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}
```

- [ ] **Step 2: Destructure `runState` in `CanvasContent`**

Change the `CanvasContent` function signature (line ~92) from:

```tsx
function CanvasContent({ definition, nodeResults, onChange, onNodeSelect, onRequestRename }, ref) {
```

to:

```tsx
function CanvasContent({ definition, nodeResults, runState, onChange, onNodeSelect, onRequestRename }, ref) {
```

- [ ] **Step 3: Add `SelectionSync` component inside `CanvasContent`**

Add this component definition immediately before the `return (` statement (before line ~306). This component uses `useOnSelectionChange` which must be called inside `<ReactFlowProvider>`:

```tsx
  const selectionChangeHandler = useCallback(({ nodes: selectedNodes }: { nodes: WorkflowFlowNode[] }) => {
    if (runState && runState !== "idle") return
    onNodeSelect?.(selectedNodes.length === 1 ? selectedNodes[0].id : null)
  }, [runState, onNodeSelect])

  useOnSelectionChange({ onChange: selectionChangeHandler })
```

- [ ] **Step 4: Update `onNodeClick` to only handle run-state viewing**

Change `onNodeClick` (line ~204-206) from:

```tsx
  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowFlowNode) => {
    onNodeSelect?.(node.id)
  }, [onNodeSelect])
```

to:

```tsx
  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowFlowNode) => {
    if (runState && runState !== "idle") {
      onNodeSelect?.(node.id)
    }
  }, [runState, onNodeSelect])
```

- [ ] **Step 5: Remove the `onPaneClick` handler**

Delete the `onPaneClick` callback (line ~208-210):

```tsx
  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null)
  }, [onNodeSelect])
```

This is no longer needed — `useOnSelectionChange` fires with an empty `nodes` array when the user clicks the pane (React Flow deselects all), which already calls `onNodeSelect(null)`.

- [ ] **Step 6: Remove `onPaneClick` from the `<ReactFlow>` props**

In the `<ReactFlow>` JSX, remove the `onPaneClick={onPaneClick}` prop. Change:

```tsx
          onNodeClick={onNodeClick} onPaneClick={onPaneClick}
```

to:

```tsx
          onNodeClick={onNodeClick}
```

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): sync selection state via useOnSelectionChange"
```

---

### Task 3: Pass runState from editor-app to canvas

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx:261` (WorkflowCanvas usage)

- [ ] **Step 1: Add `runState` prop to `WorkflowCanvas`**

Change line ~261 from:

```tsx
              <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
```

to:

```tsx
              <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} runState={runState} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): pass runState to WorkflowCanvas for multi-select"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Verify in the running app**

Open a workflow in the editor. Check each interaction:

1. **Box selection**: Drag on empty canvas area → should draw a selection rectangle, nodes inside get selected (blue ring or highlight)
2. **Batch move**: With 2+ nodes selected, drag one → all selected nodes move together
3. **Batch delete**: With 2+ nodes selected (not including end node), press Delete/Backspace → all deleted
4. **End-node protection**: Select end node + another node, press Delete → only non-end node deleted, toast "结束节点已跳过"
5. **Right-click multi-select**: Select 2+ nodes, right-click one → context menu copy/delete/disconnect applies to all
6. **Single click**: Click a single node → side panel shows its config
7. **Click pane**: Click empty area → selection cleared, side panel returns to empty state
8. **Scroll to pan**: Scroll / trackpad → canvas pans (unchanged behavior)
9. **Run-state viewing**: Run workflow, click a completed node → result viewer opens (unchanged behavior)

- [ ] **Step 2: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(workflow): multi-select adjustments from manual testing"
```
