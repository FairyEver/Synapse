# Workflow Canvas Auto-Layout

## Summary

Add a one-click auto-layout feature to the workflow editor canvas. Uses Dagre (DAG layout algorithm) to automatically arrange nodes in a left-to-right hierarchy, respecting node sizes for spacing.

## Requirements

- Layout direction: left-to-right (LR)
- Node spacing adapts to actual node dimensions (no overlap)
- After layout, fitView to show all nodes
- No animation — nodes jump to new positions instantly
- Entry point: canvas blank-area right-click context menu

## Architecture

```
canvas.tsx → autoLayout(nodes, edges) → new positions → setNodes → fitView
```

### New Module: `auto-layout.ts`

Pure function, no side effects. Signature:

```typescript
import type { Node, Edge } from "@xyflow/react"

export function autoLayout(nodes: Node[], edges: Edge[]): Node[]
```

Steps:
1. Create dagre Graph with `rankdir: 'LR'`
2. Add each node with its measured width/height (from `node.measured`, fallback: 200x80 for prompt/switch, 100x40 for end)
3. Add all edges
4. Run `dagre.layout(graph)`
5. Read new positions (dagre returns center-point, convert to top-left for XYFlow)
6. Return nodes array with updated positions

### Spacing Configuration

- `nodesep`: 50px (vertical gap between nodes in same rank)
- `ranksep`: 100px (horizontal gap between ranks/layers)
- Dagre automatically accounts for node dimensions on top of these gaps

### Canvas Integration

In `canvas.tsx`, pane context menu:
- Add "自动布局" button below existing "粘贴" button
- On click:
  1. Call `autoLayout(nodes, edges)`
  2. Update nodes state
  3. Propagate position changes to definition via existing `onChange` flow (marks dirty)
  4. Call `fitView({ padding: 0.1 })`

### Dependencies

- `@dagrejs/dagre` (~30KB gzipped) — standard DAG layout library, well-maintained, commonly paired with XYFlow

## File Changes

| File | Change |
|------|--------|
| `src/modules/workflow/editor/auto-layout.ts` | New — layout pure function |
| `src/modules/workflow/editor/canvas.tsx` | Add menu item + call layout function |
| `package.json` | Add `@dagrejs/dagre` dependency |

## Edge Cases

- Single node: layout is a no-op (or just centers it)
- Disconnected nodes: dagre handles them, places in separate columns
- Switch node with many branches: node height is measured from DOM, dagre spaces accordingly

## Not In Scope

- Animation/transition
- Multiple layout directions (only LR)
- Undo (relies on existing dirty-state mechanism — user can close without saving)
- Keyboard shortcut (can be added later)
