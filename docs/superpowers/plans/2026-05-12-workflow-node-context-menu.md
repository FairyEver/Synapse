# Workflow Node Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to workflow editor nodes with delete, copy, paste, rename, and disconnect operations.

**Architecture:** Each node wrapper in `node-wrappers.tsx` is wrapped with a shared `NodeContextMenu` component that uses shadcn's Radix-based `ContextMenu`. Clipboard state and mutation callbacks live in a React context provided by `CanvasContent`. Rename triggers focus on the `NodeConfigPanel` name input via a signal ref.

**Tech Stack:** React, @xyflow/react, shadcn/ui ContextMenu (Radix), TypeScript

**Spec:** `docs/superpowers/specs/2026-05-12-workflow-node-context-menu-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/src/modules/workflow/editor/node-context-menu.tsx` | Create | Context menu component with all menu items |
| `desktop/src/modules/workflow/editor/canvas-context.ts` | Create | React context for clipboard + node action callbacks |
| `desktop/src/modules/workflow/editor/canvas.tsx` | Modify | Provide `CanvasActionsContext`, implement copy/paste/disconnect/delete logic |
| `desktop/src/modules/workflow/editor/node-wrappers.tsx` | Modify | Wrap each node wrapper with `NodeContextMenu` |
| `desktop/src/modules/workflow/editor/node-config-panel.tsx` | Modify | Accept `renameSignal` ref and auto-focus name input |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Modify | Create + pass `renameSignal` ref |

---

### Task 1: Create canvas context for actions and clipboard

**Files:**
- Create: `desktop/src/modules/workflow/editor/canvas-context.ts`

- [ ] **Step 1: Create the context file**

```ts
// desktop/src/modules/workflow/editor/canvas-context.ts
import { createContext, useContext } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/workflow"

export interface NodeClipboard {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface CanvasActions {
  clipboard: NodeClipboard | null
  getSelectedNodeIds: () => string[]
  copyNodes: (nodeIds: string[]) => void
  pasteNodes: (anchorNodeId: string) => void
  disconnectNodes: (nodeIds: string[]) => void
  deleteNodes: (nodeIds: string[]) => void
  requestRename: (nodeId: string) => void
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null)

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsContext)
  if (!ctx) throw new Error("useCanvasActions must be used within CanvasActionsContext")
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas-context.ts
git commit -m "feat(workflow): add CanvasActionsContext for node context menu"
```

---

### Task 2: Create `NodeContextMenu` component

**Files:**
- Create: `desktop/src/modules/workflow/editor/node-context-menu.tsx`

- [ ] **Step 1: Create the context menu component**

```tsx
// desktop/src/modules/workflow/editor/node-context-menu.tsx
import type { ReactNode } from "react"
import { Trash2, Copy, Clipboard, Type, Unlink } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { useCanvasActions } from "./canvas-context"

interface NodeContextMenuProps {
  nodeId: string
  nodeType: string
  children: ReactNode
}

export function NodeContextMenu({ nodeId, nodeType, children }: NodeContextMenuProps) {
  const { clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, requestRename } = useCanvasActions()

  const handleAction = (action: () => void) => {
    // Determine which nodes to act on: if the right-clicked node is in the
    // current selection, operate on all selected nodes; otherwise only on
    // the right-clicked node.
    action()
  }

  const resolveTargetIds = (): string[] => {
    const selected = getSelectedNodeIds()
    return selected.includes(nodeId) ? selected : [nodeId]
  }

  const isEndNode = nodeType === "end"
  const isMulti = (() => {
    const selected = getSelectedNodeIds()
    return selected.includes(nodeId) && selected.length > 1
  })()

  return (
    <ContextMenu data-track="workflow-node-context-menu">
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuContent>
        {!isMulti && (
          <ContextMenuItem
            data-track="rename"
            onSelect={() => requestRename(nodeId)}
          >
            <Type className="size-4" />
            重命名
          </ContextMenuItem>
        )}
        <ContextMenuItem
          data-track="copy"
          onSelect={() => handleAction(() => copyNodes(resolveTargetIds()))}
        >
          <Copy className="size-4" />
          复制
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          data-track="paste"
          disabled={!clipboard}
          onSelect={() => handleAction(() => pasteNodes(nodeId))}
        >
          <Clipboard className="size-4" />
          粘贴
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-track="disconnect"
          onSelect={() => handleAction(() => disconnectNodes(resolveTargetIds()))}
        >
          <Unlink className="size-4" />
          断开所有连线
        </ContextMenuItem>
        {!isEndNode && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              data-track="delete"
              onSelect={() => handleAction(() => deleteNodes(resolveTargetIds()))}
            >
              <Trash2 className="size-4" />
              删除
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-context-menu.tsx
git commit -m "feat(workflow): add NodeContextMenu component"
```

---

### Task 3: Implement canvas actions in `canvas.tsx`

**Files:**
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx`

- [ ] **Step 1: Add imports for the new context**

Add to the import section of `canvas.tsx`:

```ts
import { CanvasActionsContext, type NodeClipboard } from "./canvas-context"
```

Also add `useState` to the existing React import and `toast` is already imported.

- [ ] **Step 2: Add clipboard state and rename signal ref inside `CanvasContent`**

Inside `CanvasContent`, after the existing `definitionRef` declaration (line ~101), add:

```ts
  const [clipboard, setClipboard] = useState<NodeClipboard | null>(null)
```

- [ ] **Step 3: Add `getSelectedNodeIds` helper**

After the `useImperativeHandle` block (~line 117), add:

```ts
  const getSelectedNodeIds = useCallback((): string[] => {
    return nodesRef.current.filter((n) => n.selected).map((n) => n.id)
  }, [])
```

- [ ] **Step 4: Add `copyNodes` callback**

```ts
  const copyNodes = useCallback((nodeIds: string[]) => {
    const def = definitionRef.current
    // Filter out End nodes — they cannot be copied
    const copyableIds = nodeIds.filter((id) => {
      const node = def.nodes.find((n) => n.id === id)
      return node && node.type !== "end"
    })
    if (copyableIds.length === 0) {
      toast("结束节点不能复制")
      return
    }
    const idSet = new Set(copyableIds)
    const copiedNodes = def.nodes.filter((n) => idSet.has(n.id))
    // Keep only edges where both endpoints are in the copied set
    const copiedEdges = def.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to))
    setClipboard({ nodes: copiedNodes, edges: copiedEdges })
    toast(`已复制 ${copiedNodes.length} 个节点`)
  }, [])
```

- [ ] **Step 5: Add `pasteNodes` callback**

```ts
  const pasteNodes = useCallback((anchorNodeId: string) => {
    const cb = clipboard
    if (!cb || cb.nodes.length === 0) return
    const anchorNode = nodesRef.current.find((n) => n.id === anchorNodeId)
    const offsetX = anchorNode ? 50 : 50
    const offsetY = anchorNode ? 50 : 50

    // Build old→new id mapping
    const idMap = new Map<string, string>()
    cb.nodes.forEach((n) => idMap.set(n.id, crypto.randomUUID()))

    const newNodes = cb.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    }))
    const newEdges = cb.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }))

    // Add to ReactFlow nodes
    const flowNodes = newNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.config, name: n.name },
      selected: true,
      deletable: n.type !== "end",
    }))

    // Deselect existing nodes, add new ones selected
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(flowNodes))

    // Add edges
    const flowEdges: WorkflowFlowEdge[] = newEdges.map((e) => {
      const branchLabel = e.branch ? resolveBranchLabel(definitionRef.current, e.from, e.branch) : undefined
      return {
        id: e.id, source: e.from, target: e.to, sourceHandle: e.branch ?? null,
        ...(branchLabel ? { type: "branch" as const, data: { label: branchLabel } } : {}),
      }
    })
    setEdges((eds) => eds.concat(flowEdges))

    // Update definition
    const newDef = {
      ...definitionRef.current,
      nodes: [...definitionRef.current.nodes, ...newNodes],
      edges: [...definitionRef.current.edges, ...newEdges],
    }
    definitionRef.current = newDef
    onChange(newDef)
  }, [clipboard, onChange, setNodes, setEdges])
```

- [ ] **Step 6: Add `disconnectNodes` callback**

```ts
  const disconnectNodes = useCallback((nodeIds: string[]) => {
    const idSet = new Set(nodeIds)
    setEdges((currentEdges) => {
      const updated = currentEdges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
      const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
      definitionRef.current = newDef
      onChange(newDef)
      return updated
    })
  }, [onChange, setEdges])
```

- [ ] **Step 7: Add `deleteNodes` callback**

```ts
  const deleteNodes = useCallback((nodeIds: string[]) => {
    // Filter out End nodes
    const deletableIds = nodeIds.filter((id) => {
      const node = nodesRef.current.find((n) => n.id === id)
      return node && node.type !== "end"
    })
    if (deletableIds.length === 0) {
      toast("结束节点不能删除")
      return
    }
    if (deletableIds.length < nodeIds.length) {
      toast("结束节点已跳过")
    }
    const changes: NodeChange<WorkflowFlowNode>[] = deletableIds.map((id) => ({ type: "remove", id }))
    handleNodesChange(changes)
  }, [handleNodesChange])
```

- [ ] **Step 8: Add `requestRename` callback**

The `canvas.tsx` `WorkflowCanvasProps` interface needs a new optional prop. Add to the interface:

```ts
  onRequestRename?: (nodeId: string) => void
```

Then the callback:

```ts
  const requestRename = useCallback((nodeId: string) => {
    onNodeSelect?.(nodeId)
    onRequestRename?.(nodeId)
  }, [onNodeSelect, onRequestRename])
```

- [ ] **Step 9: Build the `canvasActions` value and wrap the return JSX with the provider**

After all the callbacks, build the memoized context value:

```ts
  const canvasActions = useMemo(() => ({
    clipboard,
    getSelectedNodeIds,
    copyNodes,
    pasteNodes,
    disconnectNodes,
    deleteNodes,
    requestRename,
  }), [clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, requestRename])
```

Add `useMemo` to the React import.

Wrap the return value — change the outer element from `<NodeResultsContext.Provider>` to:

```tsx
  return (
    <CanvasActionsContext.Provider value={canvasActions}>
      <NodeResultsContext.Provider value={nodeResults ?? {}}>
        <ReactFlow ...>
          ...
        </ReactFlow>
      </NodeResultsContext.Provider>
    </CanvasActionsContext.Provider>
  )
```

- [ ] **Step 10: Pass `onRequestRename` through the outer `WorkflowCanvas` wrapper**

Update `WorkflowCanvasProps` to include `onRequestRename`:

```ts
interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  nodeResults?: Record<string, NodeRunResult>
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}
```

The outer `WorkflowCanvas` already spreads `{...props}` to `CanvasContent`, so no other change needed.

- [ ] **Step 11: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): implement clipboard and node actions in canvas"
```

---

### Task 4: Wrap node wrappers with `NodeContextMenu`

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-wrappers.tsx`

- [ ] **Step 1: Add import**

Add to the top of `node-wrappers.tsx`:

```ts
import { NodeContextMenu } from "./node-context-menu"
```

- [ ] **Step 2: Wrap `PromptNodeWrapper`**

Change the return of `PromptNodeWrapper` from:

```tsx
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} status={status} />
      <Handle type="source" position={Position.Right} />
    </>
  )
```

to:

```tsx
  return (
    <NodeContextMenu nodeId={id} nodeType="prompt">
      <div>
        <Handle type="target" position={Position.Left} />
        <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} status={status} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
```

The `<div>` wrapper is needed because `ContextMenuTrigger` requires a single child that can receive a ref.

- [ ] **Step 3: Wrap `SwitchNodeWrapper`**

Change the return to:

```tsx
  return (
    <NodeContextMenu nodeId={id} nodeType="switch">
      <div>
        <Handle type="target" position={Position.Left} />
        <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} status={status} />
        {branches.map((b, i) => (
          <Handle
            key={b.id}
            type="source"
            position={Position.Right}
            id={b.id}
            style={{ top: `${SWITCH_HEADER_H + (i + 0.5) * SWITCH_BRANCH_H}px` }}
          />
        ))}
      </div>
    </NodeContextMenu>
  )
```

- [ ] **Step 4: Wrap `EndNodeWrapper`**

Change the return to:

```tsx
  return (
    <NodeContextMenu nodeId={id} nodeType="end">
      <div>
        <Handle type="target" position={Position.Left} />
        <EndNodeCard config={data as EndNodeConfig} name={name} selected={selected} status={status} />
      </div>
    </NodeContextMenu>
  )
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-wrappers.tsx
git commit -m "feat(workflow): wrap node wrappers with NodeContextMenu"
```

---

### Task 5: Wire rename signal from `editor-app.tsx` to `NodeConfigPanel`

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx`
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`

- [ ] **Step 1: Add rename signal ref in `editor-app.tsx`**

After the existing `canvasRef` declaration (~line 35), add:

```ts
  const renameSignalRef = useRef<number>(0)
```

Add a handler:

```ts
  const handleRequestRename = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setViewingNodeId(null)
    renameSignalRef.current += 1
  }, [])
```

- [ ] **Step 2: Pass `onRequestRename` to `WorkflowCanvas` and `renameSignal` to `NodeConfigPanel`**

On the `WorkflowCanvas` element, add:

```tsx
<WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
```

On the `NodeConfigPanel` element, add `renameSignal`:

```tsx
<NodeConfigPanel nodeId={runState === "idle" ? selectedNodeId : null} definition={definition} onConfigChange={handleConfigChange} onNameChange={handleNameChange} renameSignal={renameSignalRef.current} />
```

- [ ] **Step 3: Update `NodeConfigPanel` to accept and react to `renameSignal`**

In `node-config-panel.tsx`, add `useEffect` and `useRef` to the React import.

Update the props interface:

```ts
interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  renameSignal?: number
}
```

Update the function signature to destructure `renameSignal`:

```ts
export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange, renameSignal }: NodeConfigPanelProps) {
```

Add a ref for the name input and focus logic. After the `upstreamNodes` line, add:

```ts
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renameSignal && renameSignal > 0) {
      // Small delay to ensure the input is rendered after node selection change
      const timer = setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [renameSignal])
```

On the `<Input>` for node name, add the ref:

```tsx
<Input
  ref={nameInputRef}
  className="h-7 text-xs font-medium"
  defaultValue={node.name}
  key={node.id}
  onBlur={(e) => onNameChange(node.id, e.target.value)}
/>
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "feat(workflow): wire rename signal from context menu to config panel"
```

---

### Task 6: Verify and polish

- [ ] **Step 1: Run type check**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Fix any type errors.

- [ ] **Step 2: Run lint**

```bash
pnpm --filter @synapse/desktop run lint
```

Fix any lint issues.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(workflow): node context menu — polish and type fixes"
```
