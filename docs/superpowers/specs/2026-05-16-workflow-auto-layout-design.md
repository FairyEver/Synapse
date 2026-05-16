# Workflow Auto-Layout Design

## Goal

Add a one-click auto-layout action to the workflow editor canvas that arranges DAG nodes in a left-to-right hierarchy using the Dagre algorithm.

## Entry Point

Canvas blank-area right-click context menu → "自动布局" button (alongside existing "粘贴").

## Algorithm

- Library: `@dagrejs/dagre`
- Direction: LR (left-to-right)
- Node size: width 220, height 80 (matches current node card dimensions)
- Horizontal gap (ranksep): 80
- Vertical gap (nodesep): 40

## Pure Function Signature

```ts
import type { Node, Edge } from "@xyflow/react"

export function autoLayoutNodes(
  nodes: Node[],
  edges: Edge[],
  options?: { direction?: "LR" | "TB"; nodeWidth?: number; nodeHeight?: number }
): Node[]
```

- Returns new nodes array with updated `position` fields
- Does not mutate input
- Nodes not in the graph (isolated) keep their position

## Canvas Integration

1. Import `autoLayoutNodes` and `useReactFlow` (already available)
2. Add `handleAutoLayout` callback:
   - Call `autoLayoutNodes(nodes, edges)`
   - `setNodes()` with new positions
   - Build new definition, update `definitionRef`, call `onChange()`
   - Call `fitView()` after a microtask
   - Log the action
3. Add menu item in pane context menu, before the paste button
   - Icon: `LayoutGrid` from lucide-react
   - Label: "自动布局"
   - No keyboard shortcut

## Files Changed

| File | Action |
|------|--------|
| `desktop/package.json` | Add `@dagrejs/dagre` dep + `@types/dagre` devDep |
| `desktop/src/modules/workflow/editor/auto-layout.ts` | New — pure layout function |
| `desktop/src/modules/workflow/editor/__tests__/auto-layout.test.ts` | New — unit tests |
| `desktop/src/modules/workflow/editor/canvas.tsx` | Modify — import, callback, menu item |
