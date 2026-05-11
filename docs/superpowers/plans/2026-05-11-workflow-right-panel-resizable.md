# Workflow Editor Right Panel Resizable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right-side node config panel in the workflow editor horizontally resizable by dragging.

**Architecture:** Wrap the canvas area and `NodeConfigPanel` in a `ResizablePanelGroup` using the existing `react-resizable-panels` primitives. `NodePalette` stays at fixed width. The config panel gets pixel-based min/default/max size constraints via `groupResizeBehavior="preserve-pixel-size"`.

**Tech Stack:** React, `react-resizable-panels` (already installed), Tailwind CSS

---

### Task 1: Remove fixed width from `NodeConfigPanel`

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx:18`

- [ ] **Step 1: Replace the fixed-width outer div**

In `node-config-panel.tsx`, change line 18 from:

```tsx
    <div className="w-60 border-l bg-background flex flex-col shrink-0">
```

to:

```tsx
    <div className="h-full w-full border-l bg-background flex flex-col">
```

The `w-60` and `shrink-0` are removed. The component now fills whatever container it is placed in. `h-full` ensures it occupies the full height of its `ResizablePanel` parent.

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "refactor(workflow): remove fixed width from NodeConfigPanel"
```

---

### Task 2: Wrap canvas + config panel in `ResizablePanelGroup`

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx:1-14` (imports), `editor-app.tsx:173-180` (layout)

- [ ] **Step 1: Add the import**

In `editor-app.tsx`, add the following import after the existing imports (line 13):

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
```

- [ ] **Step 2: Replace the layout section**

In `editor-app.tsx`, replace lines 173–180:

```tsx
      <div className="flex-1 flex min-h-0">
        <NodePalette />
        <div className="flex-1 relative">
          <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} />
          <ExecutionOverlay nodeResults={nodeResults} runState={runState} runError={runError} definition={definition} viewingNodeId={viewingNodeId} onViewClose={() => setViewingNodeId(null)} />
        </div>
        <NodeConfigPanel nodeId={runState === "idle" ? selectedNodeId : null} definition={definition} onConfigChange={handleConfigChange} onNameChange={handleNameChange} />
      </div>
```

with:

```tsx
      <div className="flex-1 flex min-h-0">
        <NodePalette />
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel>
            <div className="h-full relative">
              <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} />
              <ExecutionOverlay nodeResults={nodeResults} runState={runState} runError={runError} definition={definition} viewingNodeId={viewingNodeId} onViewClose={() => setViewingNodeId(null)} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={240}
            minSize={200}
            maxSize={480}
            groupResizeBehavior="preserve-pixel-size"
          >
            <NodeConfigPanel nodeId={runState === "idle" ? selectedNodeId : null} definition={definition} onConfigChange={handleConfigChange} onNameChange={handleNameChange} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): make right config panel horizontally resizable"
```
