# Workflow Side-Effect Branches Design

## Summary

Allow workflow nodes that branch off the main path (don't connect to End) to execute normally. The End node acts as a barrier — it only triggers after ALL other nodes complete, not just its direct upstream dependencies.

## Motivation

Users need "fire-and-forget" parallel branches that perform side tasks (logging, notifications, secondary API calls) without blocking the main path's progress, while still being part of the overall workflow completion.

Example scenario:
```
A → A1 (side-effect, no path to End)
A → A2 → B → End
A → A3 (side-effect, no path to End)
```

Expected behavior:
1. A runs first
2. A1, A2, A3 start in parallel
3. A2 completes → B starts immediately (doesn't wait for A1/A3)
4. B completes, but End does NOT trigger yet (A1/A3 may still be running)
5. A1, A3, B all complete → End triggers → workflow finishes

## Current Limitation

`computeEndReachable` in `workflow-utils.ts` performs a reverse BFS from End. Nodes without a path to End (A1, A3) are pruned and marked as `skipped` without execution.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Side-effect branch identification | Auto-inferred (no user annotation needed) |
| Side-effect branch failure | Fails the entire workflow (End not executed) |
| End node can reference side-effect outputs | Yes |
| Side-effect branch depth | Multi-node chains supported |

## Approach: Implicit Edge Insertion

### Core Algorithm

New function `computeFullExecutionSet(def)` in `workflow-utils.ts`:

```
Input: WorkflowDefinition
Output: { executableNodeIds: Set<string>, implicitEdges: Array<{from: string, to: string}> }

1. mainPathSet = computeEndReachable(def)
   If empty (no End node), return all nodes with no implicit edges.

2. Forward BFS from all nodes in mainPathSet:
   Follow outgoing edges. Collect target nodes NOT in mainPathSet → sideEffectSet.
   Continue BFS from sideEffectSet nodes to find full chains.

3. fullSet = mainPathSet ∪ sideEffectSet

4. Find leaf nodes in sideEffectSet:
   leaf = node in sideEffectSet with no outgoing edge to another node in fullSet

5. endNodeId = End node id
   implicitEdges = [{from: leaf, to: endNodeId} for each leaf]

Return { executableNodeIds: fullSet, implicitEdges }
```

### Engine Integration

Changes in `workflow-engine.ts` (lines 77-96 area):

**Before:**
```typescript
const canReachEnd = computeEndReachable(def)
const executableNodes = def.nodes
  .filter((n) => canReachEnd.size === 0 || canReachEnd.has(n.id))
  .map((n) => n.id)
const executableEdges = def.edges
  .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
  .map((e) => ({ from: e.from, to: e.to }))
```

**After:**
```typescript
const { executableNodeIds, implicitEdges } = computeFullExecutionSet(def)
const executableNodes = def.nodes
  .filter((n) => executableNodeIds.size === 0 || executableNodeIds.has(n.id))
  .map((n) => n.id)
const executableSet = new Set(executableNodes)
const executableEdges = [
  ...def.edges
    .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
    .map((e) => ({ from: e.from, to: e.to })),
  ...implicitEdges,
]
```

### `resolveActivatedDownstream` Callback

Must iterate `executableEdges` (including implicit edges) instead of `def.edges`:

```typescript
resolveActivatedDownstream: (nodeId, outcome) => {
  const activated: string[] = []
  for (const edge of executableEdges.filter((e) => e.from === nodeId)) {
    const defEdge = def.edges.find((de) => de.from === edge.from && de.to === edge.to)
    if (!outcome.activeBranch || !defEdge?.branch || defEdge.branch === outcome.activeBranch) {
      activated.push(edge.to)
    }
  }
  return activated
},
```

Implicit edges have no `branch` property, so they are always activated.

## Unchanged Modules

- `ReactiveScheduler`: zero changes
- `variable-resolver.ts`: zero changes
- UI editor: no need to display implicit edges
- Node type registry: zero changes

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No side-effect branches (all nodes connect to End) | implicitEdges is empty, behavior identical to current |
| No End node | Returns all nodes, no implicit edges (existing fallback) |
| Side-effect chain reconnects to main path (A→X→B, B on main path) | X is already in mainPathSet via computeEndReachable, not a side-effect |
| Diamond in side-effect (A→A1→X, A→A3→X) | X is the only leaf, one implicit edge X→End |
| Side-effect branches from non-root main-path node (B→S1) | Forward BFS from B finds S1, S1→End implicit edge added |
| Switch node's inactive branch | Handled by existing resolveActivatedDownstream skip logic, unaffected |
| Switch node inside a side-effect chain | Runs normally; inactive sub-branches skipped via existing logic |

## Test Plan

1. **Basic scenario**: A→A1, A→A2→B→End, A→A3 — A1/A3 execute, End waits for all
2. **Multi-node chain**: A→A1→A1a→A1b, A→A2→B→End — full chain executes, End waits for A1b
3. **Side-effect failure**: A1 fails → End skipped, workflow status = failed
4. **No side-effects**: A→B→End — behavior unchanged (regression test)
5. **Diamond side-effect**: A→A1→X, A→A3→X, A→A2→B→End — X is leaf, End waits for X
6. **End references side-effect output**: End template uses `{{A1 output}}` — value correct
7. **Timing**: A1 takes 100ms, A2 takes 10ms, B takes 10ms — B starts immediately after A2 (doesn't wait for A1), End triggers only after A1 completes

## Performance

Forward BFS is O(V+E), same order as existing reverse BFS. Negligible for typical workflows (tens of nodes).

## Files Changed

| File | Change |
|------|--------|
| `desktop/electron/services/workflow/workflow-utils.ts` | Add `computeFullExecutionSet` |
| `desktop/electron/services/workflow/workflow-engine.ts` | Use new function, update edge iteration in resolveActivatedDownstream |
| `desktop/electron/services/__tests__/workflow-engine.test.ts` | Add test cases 1-7 |
| `desktop/electron/services/__tests__/workflow-scheduler.test.ts` | Optional: add timing-sensitive test |
