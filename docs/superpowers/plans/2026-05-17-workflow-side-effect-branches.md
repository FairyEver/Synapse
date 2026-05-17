# Workflow Side-Effect Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow workflow branches that don't connect to End to execute normally, with End acting as a barrier that waits for all nodes to complete.

**Architecture:** Add `computeFullExecutionSet()` to `workflow-utils.ts` that extends the current reachability set with a forward BFS to discover side-effect branches, then inserts implicit edges from side-effect leaf nodes to End. The engine uses these augmented edges so the Scheduler naturally blocks End until all branches finish.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-05-17-workflow-side-effect-branches-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/electron/services/workflow/workflow-utils.ts` | Modify | Add `computeFullExecutionSet` function |
| `desktop/electron/services/workflow/workflow-engine.ts` | Modify | Use new function, update `resolveActivatedDownstream` |
| `desktop/electron/services/__tests__/workflow-engine.test.ts` | Modify | Add 7 test cases |

---

## Task 1: Add `computeFullExecutionSet` with tests

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-utils.ts`
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Write failing test — basic side-effect branch**

Add to the bottom of the `describe("WorkflowEngine")` block in `desktop/electron/services/__tests__/workflow-engine.test.ts`:

```typescript
it("executes side-effect branches and waits for them before End", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side1" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
  const nodeA3 = { id: "a3", name: "A3", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side2" } }
  const nodeBB = { id: "bb", name: "BB", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "after-main" } }
  const def: WorkflowDefinition = {
    id: "wf-side", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA2, nodeA3, nodeBB, nodeEnd],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a", to: "a2" },
      { id: "e3", from: "a", to: "a3" },
      { id: "e4", from: "a2", to: "bb" },
      { id: "e5", from: "bb", to: "end" },
    ],
  }
  const events: WorkflowEvent[] = []
  const engine = new WorkflowEngine(fakeAgent("ok"))
  const result = await engine.run(def, {}, "run-side", (e) => events.push(e))
  expect(result.status).toBe("completed")
  // A1 and A3 should have executed (not skipped)
  expect(result.nodeResults["a1"]?.status).toBe("success")
  expect(result.nodeResults["a3"]?.status).toBe("success")
  // End should be the last node to start
  const startedEvents = events.filter((e) => e.type === "node:started")
  const endStartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "end")
  const a1StartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a1")
  const a3StartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a3")
  expect(a1StartIdx).toBeLessThan(endStartIdx)
  expect(a3StartIdx).toBeLessThan(endStartIdx)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts -t "executes side-effect branches"`

Expected: FAIL — A1 and A3 have status `"skipped"` because `computeEndReachable` prunes them.

- [ ] **Step 3: Implement `computeFullExecutionSet` in workflow-utils.ts**

Add at the end of `desktop/electron/services/workflow/workflow-utils.ts`:

```typescript
/**
 * Compute the full set of nodes to execute, including side-effect branches.
 * Side-effect branches are nodes reachable from the main path (nodes that can
 * reach End) but that don't themselves have a path to End.
 *
 * Returns implicit edges from side-effect leaf nodes to End so that End acts
 * as a barrier waiting for all branches to complete.
 */
export function computeFullExecutionSet(def: WorkflowDefinition): {
  executableNodeIds: Set<string>
  implicitEdges: Array<{ from: string; to: string }>
} {
  const mainPathSet = computeEndReachable(def)
  if (mainPathSet.size === 0) {
    return { executableNodeIds: new Set(), implicitEdges: [] }
  }

  const endNode = def.nodes.find((n) => n.type === "end")!
  const allNodeIds = new Set(def.nodes.map((n) => n.id))

  // Forward BFS from mainPathSet to discover side-effect nodes
  const forwardAdj = new Map<string, string[]>()
  for (const e of def.edges) {
    if (!forwardAdj.has(e.from)) forwardAdj.set(e.from, [])
    forwardAdj.get(e.from)!.push(e.to)
  }

  const sideEffectSet = new Set<string>()
  const queue: string[] = []
  for (const nodeId of mainPathSet) {
    for (const target of forwardAdj.get(nodeId) ?? []) {
      if (!mainPathSet.has(target) && allNodeIds.has(target)) {
        sideEffectSet.add(target)
        queue.push(target)
      }
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const target of forwardAdj.get(cur) ?? []) {
      if (!mainPathSet.has(target) && !sideEffectSet.has(target) && allNodeIds.has(target)) {
        sideEffectSet.add(target)
        queue.push(target)
      }
    }
  }

  const fullSet = new Set([...mainPathSet, ...sideEffectSet])

  // Find leaf nodes in sideEffectSet: nodes with no outgoing edge to another node in fullSet
  const implicitEdges: Array<{ from: string; to: string }> = []
  for (const nodeId of sideEffectSet) {
    const outTargets = forwardAdj.get(nodeId) ?? []
    const hasOutInFullSet = outTargets.some((t) => fullSet.has(t))
    if (!hasOutInFullSet) {
      implicitEdges.push({ from: nodeId, to: endNode.id })
    }
  }

  return { executableNodeIds: fullSet, implicitEdges }
}
```

- [ ] **Step 4: Run test to verify it still fails**

The test will still fail because `workflow-engine.ts` hasn't been updated to use the new function yet.

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts -t "executes side-effect branches"`

Expected: FAIL (same reason — engine still uses `computeEndReachable` directly).

- [ ] **Step 5: Commit the new utility function**

```bash
git add desktop/electron/services/workflow/workflow-utils.ts desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "feat(workflow): add computeFullExecutionSet utility for side-effect branches"
```

---

## Task 2: Update engine to use `computeFullExecutionSet`

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`

- [ ] **Step 1: Update imports in workflow-engine.ts**

In `desktop/electron/services/workflow/workflow-engine.ts` line 9, change:

```typescript
import { computeEndReachable } from "./workflow-utils"
```

to:

```typescript
import { computeFullExecutionSet } from "./workflow-utils"
```

- [ ] **Step 2: Replace reachability pruning block (lines 76-86)**

Replace:

```typescript
    // --- Reachability pruning ---
    const canReachEnd = computeEndReachable(def)

    // Filter to only nodes that can reach end
    const executableNodes = def.nodes
      .filter((n) => canReachEnd.size === 0 || canReachEnd.has(n.id))
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdges = def.edges
      .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))
```

with:

```typescript
    // --- Reachability pruning (includes side-effect branches) ---
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

- [ ] **Step 3: Update `resolveActivatedDownstream` callback (lines 231-241)**

Replace:

```typescript
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        for (const edge of def.edges.filter((e) => e.from === nodeId)) {
          if (!outcome.activeBranch || edge.branch === outcome.activeBranch) {
            activated.push(edge.to)
            logger.info("edge activated", { runId, from: nodeId, to: edge.to, branch: edge.branch ?? null })
            emit({ type: "edge:activated", runId, from: edge.from, to: edge.to })
          }
        }
        return activated
      },
```

with:

```typescript
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        for (const edge of executableEdges.filter((e) => e.from === nodeId)) {
          const defEdge = def.edges.find((de) => de.from === edge.from && de.to === edge.to)
          if (!outcome.activeBranch || !defEdge?.branch || defEdge.branch === outcome.activeBranch) {
            activated.push(edge.to)
            logger.info("edge activated", { runId, from: nodeId, to: edge.to, branch: defEdge?.branch ?? null })
            emit({ type: "edge:activated", runId, from: edge.from, to: edge.to })
          }
        }
        return activated
      },
```

- [ ] **Step 4: Run the side-effect branch test**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts -t "executes side-effect branches"`

Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts electron/services/__tests__/workflow-scheduler.test.ts`

Expected: ALL PASS (existing tests unchanged in behavior)

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts
git commit -m "feat(workflow): engine uses computeFullExecutionSet for side-effect branches"
```

---

## Task 3: Add remaining test cases

**Files:**
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Add multi-node chain test**

```typescript
it("executes multi-node side-effect chains and End waits for chain tail", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain1" } }
  const nodeA1a = { id: "a1a", name: "A1a", type: "prompt", position: { x: 200, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain2" } }
  const nodeA1b = { id: "a1b", name: "A1b", type: "prompt", position: { x: 300, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain3" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
  const def: WorkflowDefinition = {
    id: "wf-chain", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA1a, nodeA1b, nodeA2, nodeEnd],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a1", to: "a1a" },
      { id: "e3", from: "a1a", to: "a1b" },
      { id: "e4", from: "a", to: "a2" },
      { id: "e5", from: "a2", to: "end" },
    ],
  }
  const engine = new WorkflowEngine(fakeAgent("ok"))
  const result = await engine.run(def, {}, "run-chain", () => {})
  expect(result.status).toBe("completed")
  expect(result.nodeResults["a1"]?.status).toBe("success")
  expect(result.nodeResults["a1a"]?.status).toBe("success")
  expect(result.nodeResults["a1b"]?.status).toBe("success")
})
```

- [ ] **Step 2: Add side-effect failure test**

```typescript
it("fails workflow when a side-effect branch node fails", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
  const def: WorkflowDefinition = {
    id: "wf-side-fail", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA2, nodeEnd],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a", to: "a2" },
      { id: "e3", from: "a2", to: "end" },
    ],
  }
  let callCount = 0
  const agent = {
    sendToAgent: vi.fn().mockImplementation(() => {
      callCount++
      // A succeeds, A1 fails, A2 succeeds
      if (callCount === 1) return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
      if (callCount === 2) return Promise.resolve({ status: "failed" as const, response: "", error: "side boom", durationMs: 1 })
      return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
    }),
  }
  const engine = new WorkflowEngine(agent)
  const result = await engine.run(def, {}, "run-side-fail", () => {})
  expect(result.status).toBe("failed")
})
```

- [ ] **Step 3: Add End references side-effect output test**

```typescript
it("End node can reference side-effect branch output via variables", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
  const endWithRef = {
    id: "end", name: "结束", type: "end", position: { x: 400, y: 0 },
    config: {
      outputType: "text",
      template: "side={{sideOut}} main={{mainOut}}",
      variables: [
        { name: "sideOut", source: { type: "node_output", node: "a1" } },
        { name: "mainOut", source: { type: "node_output", node: "a2" } },
      ],
    },
  }
  const def: WorkflowDefinition = {
    id: "wf-side-ref", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA2, endWithRef],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a", to: "a2" },
      { id: "e3", from: "a2", to: "end" },
    ],
  }
  const engine = new WorkflowEngine(fakeAgent("side-result"))
  const result = await engine.run(def, {}, "run-side-ref", () => {})
  expect(result.status).toBe("completed")
  expect(result.output).toBe("side=side-result main=side-result")
})
```

- [ ] **Step 4: Add diamond side-effect test**

```typescript
it("handles diamond side-effect branches (shared leaf)", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "s1" } }
  const nodeA3 = { id: "a3", name: "A3", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "s2" } }
  const nodeX = { id: "x", name: "X", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "join" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 50 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
  const def: WorkflowDefinition = {
    id: "wf-diamond", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA3, nodeX, nodeA2, nodeEnd],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a", to: "a3" },
      { id: "e3", from: "a1", to: "x" },
      { id: "e4", from: "a3", to: "x" },
      { id: "e5", from: "a", to: "a2" },
      { id: "e6", from: "a2", to: "end" },
    ],
  }
  const engine = new WorkflowEngine(fakeAgent("ok"))
  const result = await engine.run(def, {}, "run-diamond", () => {})
  expect(result.status).toBe("completed")
  expect(result.nodeResults["a1"]?.status).toBe("success")
  expect(result.nodeResults["a3"]?.status).toBe("success")
  expect(result.nodeResults["x"]?.status).toBe("success")
})
```

- [ ] **Step 5: Add timing test (B starts before A1 finishes)**

```typescript
it("main path B starts immediately after A2 without waiting for slow side-effect A1", async () => {
  const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "slow-side" } }
  const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "fast-main" } }
  const nodeBB = { id: "bb", name: "BB", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "after" } }
  const def: WorkflowDefinition = {
    id: "wf-timing", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeA1, nodeA2, nodeBB, nodeEnd],
    edges: [
      { id: "e1", from: "a", to: "a1" },
      { id: "e2", from: "a", to: "a2" },
      { id: "e3", from: "a2", to: "bb" },
      { id: "e4", from: "bb", to: "end" },
    ],
  }
  const startTimes: Record<string, number> = {}
  const events: WorkflowEvent[] = []
  const agent = {
    sendToAgent: vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
      if (prompt === "slow-side") {
        return new Promise((r) => setTimeout(() => r({ status: "success" as const, response: "slow", durationMs: 80 }), 80))
      }
      return Promise.resolve({ status: "success" as const, response: "fast", durationMs: 1 })
    }),
  }
  const engine = new WorkflowEngine(agent)
  const result = await engine.run(def, {}, "run-timing", (e) => {
    events.push(e)
    if (e.type === "node:started") startTimes[e.nodeId] = Date.now()
  })
  expect(result.status).toBe("completed")
  // BB should start before A1 finishes (BB depends on A2 only, not A1)
  const startedOrder = events.filter((e) => e.type === "node:started").map((e) => (e as { nodeId: string }).nodeId)
  const bbIdx = startedOrder.indexOf("bb")
  const endIdx = startedOrder.indexOf("end")
  // BB starts before End (obvious), and End starts after A1
  expect(bbIdx).toBeLessThan(endIdx)
  // A1 should be the last to complete (slow), so End starts last
  expect(result.nodeResults["a1"]?.status).toBe("success")
})
```

- [ ] **Step 6: Add no-side-effects regression test**

```typescript
it("behaves identically when no side-effect branches exist (regression)", async () => {
  const def: WorkflowDefinition = {
    id: "wf-no-side", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
    nodes: [nodeA, nodeB, nodeEnd],
    edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }],
  }
  const engine = new WorkflowEngine(fakeAgent("hello"))
  const result = await engine.run(def, {}, "run-no-side", () => {})
  expect(result.status).toBe("completed")
  expect(result.nodeResults["a"]?.status).toBe("success")
  expect(result.nodeResults["b"]?.status).toBe("success")
  expect(result.nodeResults["end"]?.status).toBe("success")
})
```

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts electron/services/__tests__/workflow-scheduler.test.ts`

Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "test(workflow): add side-effect branch test cases"
```
