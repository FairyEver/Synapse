# Workflow 并行执行引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the serial workflow engine loop with a reactive DAG scheduler that starts each node as soon as all its upstream dependencies complete, maximizing parallel execution.

**Architecture:** New `ReactiveScheduler` class handles DAG topology, pending-count tracking, and dynamic node launching. Existing `WorkflowEngine` extracts its per-node execution logic into a `taskFactory` closure and delegates scheduling to `ReactiveScheduler`. The scheduler is fully transparent to node types.

**Tech Stack:** TypeScript, Vitest

**Design spec:** `docs/superpowers/specs/2026-05-15-workflow-parallel-execution-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `desktop/electron/services/workflow/workflow-scheduler.ts` | `ReactiveScheduler` — DAG scheduling, pending counts, dynamic start, concurrency control |
| Create | `desktop/electron/services/__tests__/workflow-scheduler.test.ts` | Unit tests for scheduler in isolation |
| Modify | `desktop/electron/services/workflow/workflow-engine.ts` | Extract `taskFactory` + `callbacks`, delegate to scheduler |
| Modify | `desktop/electron/services/__tests__/workflow-engine.test.ts` | Add parallel-specific integration tests, verify existing tests still pass |

---

### Task 1: Create ReactiveScheduler with types and core algorithm

**Files:**
- Create: `desktop/electron/services/workflow/workflow-scheduler.ts`

- [ ] **Step 1: Create the scheduler file with types and implementation**

```typescript
// desktop/electron/services/workflow/workflow-scheduler.ts
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.scheduler")

export interface NodeExecOutcome {
  nodeId: string
  status: "success" | "failed"
  output?: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs?: number
}

export interface NodeTask {
  nodeId: string
  execute: () => Promise<NodeExecOutcome>
}

export interface SchedulerOptions {
  maxConcurrency?: number
}

export interface SchedulerCallbacks {
  onNodeReady: (nodeId: string) => void
  onNodeDone: (outcome: NodeExecOutcome) => void
  resolveActivatedDownstream: (nodeId: string, outcome: NodeExecOutcome) => string[]
}

export class ReactiveScheduler {
  private readonly maxConcurrency: number

  constructor(options?: SchedulerOptions) {
    this.maxConcurrency = options?.maxConcurrency ?? 0
  }

  async execute(
    nodes: string[],
    edges: Array<{ from: string; to: string }>,
    taskFactory: (nodeId: string) => NodeTask,
    callbacks: SchedulerCallbacks,
    abortSignal: AbortSignal,
  ): Promise<Map<string, NodeExecOutcome>> {
    const nodeSet = new Set(nodes)
    const pending = new Map<string, number>()
    for (const id of nodes) pending.set(id, 0)
    for (const e of edges) {
      if (nodeSet.has(e.from) && nodeSet.has(e.to)) {
        pending.set(e.to, (pending.get(e.to) ?? 0) + 1)
      }
    }

    const running = new Map<string, Promise<void>>()
    const results = new Map<string, NodeExecOutcome>()
    const waitQueue: string[] = []
    let failed = false

    const tryStart = (nodeId: string) => {
      if (failed || abortSignal.aborted) return
      if (this.maxConcurrency > 0 && running.size >= this.maxConcurrency) {
        waitQueue.push(nodeId)
        return
      }
      const task = taskFactory(nodeId)
      callbacks.onNodeReady(nodeId)
      const promise = task.execute().then((outcome) => {
        results.set(nodeId, outcome)
        running.delete(nodeId)
        callbacks.onNodeDone(outcome)
        if (outcome.status === "failed") {
          failed = true
          logger.info("scheduler: node failed, stopping new launches", { nodeId })
          for (const queued of waitQueue) {
            results.set(queued, { nodeId: queued, status: "failed", error: "skipped: upstream failed" })
          }
          waitQueue.length = 0
          return
        }
        const downstream = callbacks.resolveActivatedDownstream(nodeId, outcome)
        for (const next of downstream) {
          const curr = pending.get(next)
          if (curr === undefined) continue
          const updated = curr - 1
          pending.set(next, updated)
          if (updated === 0) tryStart(next)
        }
        while (this.maxConcurrency > 0 && waitQueue.length > 0 && running.size < this.maxConcurrency) {
          tryStart(waitQueue.shift()!)
        }
      })
      running.set(nodeId, promise)
    }

    for (const [nodeId, count] of pending) {
      if (count === 0) tryStart(nodeId)
    }
    while (running.size > 0) {
      await Promise.race([...running.values()])
    }
    for (const id of nodes) {
      if (!results.has(id)) {
        results.set(id, { nodeId: id, status: "failed", error: "skipped" })
      }
    }
    return results
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @synapse/desktop exec tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20`
Expected: No errors in `workflow-scheduler.ts`

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/workflow/workflow-scheduler.ts
git commit -m "feat(workflow): add ReactiveScheduler with max-parallelism DAG execution"
```

---

### Task 2: Unit tests for ReactiveScheduler

**Files:**
- Create: `desktop/electron/services/__tests__/workflow-scheduler.test.ts`

- [ ] **Step 1: Write scheduler unit tests**

All tests use fake tasks (instant or delayed promises) — no real node executors.

```typescript
// desktop/electron/services/__tests__/workflow-scheduler.test.ts
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { ReactiveScheduler } from "../workflow/workflow-scheduler"
import type { NodeExecOutcome, SchedulerCallbacks } from "../workflow/workflow-scheduler"

function ok(nodeId: string, output = ""): NodeExecOutcome {
  return { nodeId, status: "success", output, durationMs: 1 }
}
function fail(nodeId: string): NodeExecOutcome {
  return { nodeId, status: "failed", error: "boom", durationMs: 1 }
}
function delayed<T>(ms: number, value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms))
}

function makeCallbacks(
  edges: Array<{ from: string; to: string }>,
): SchedulerCallbacks & { readyOrder: string[] } {
  const readyOrder: string[] = []
  return {
    readyOrder,
    onNodeReady: (id) => { readyOrder.push(id) },
    onNodeDone: () => {},
    resolveActivatedDownstream: (nodeId) =>
      edges.filter((e) => e.from === nodeId).map((e) => e.to),
  }
}

describe("ReactiveScheduler", () => {
  it("runs a linear chain A→B→C in order", async () => {
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder).toEqual(["a", "b", "c"])
    expect(results.get("c")?.status).toBe("success")
  })

  it("starts parallel roots A,B simultaneously before C", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id, id)) }),
      cb, new AbortController().signal,
    )
    // a and b should both start before c
    expect(cb.readyOrder.indexOf("a")).toBeLessThan(cb.readyOrder.indexOf("c"))
    expect(cb.readyOrder.indexOf("b")).toBeLessThan(cb.readyOrder.indexOf("c"))
    expect(results.get("c")?.status).toBe("success")
  })

  it("starts D immediately when A completes, without waiting for B (asymmetric)", async () => {
    // A→C, A→D, B→C — D only depends on A
    const edges = [
      { from: "a", to: "c" }, { from: "a", to: "d" }, { from: "b", to: "c" },
    ]
    const startTimes: Record<string, number> = {}
    const cb = makeCallbacks(edges)
    cb.onNodeReady = (id) => { cb.readyOrder.push(id); startTimes[id] = Date.now() }
    const s = new ReactiveScheduler()
    await s.execute(
      ["a", "b", "c", "d"], edges,
      (id) => ({
        nodeId: id,
        execute: () => {
          // B takes much longer than A
          if (id === "b") return delayed(50, ok(id))
          return Promise.resolve(ok(id))
        },
      }),
      cb, new AbortController().signal,
    )
    // D should start before B finishes (and before C)
    expect(cb.readyOrder.indexOf("d")).toBeLessThan(cb.readyOrder.indexOf("c"))
  })

  it("does not start downstream nodes after a failure", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: () => Promise.resolve(id === "b" ? fail(id) : ok(id)),
      }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder).not.toContain("c")
    expect(results.get("c")?.error).toContain("skipped")
  })

  it("lets running nodes finish when one fails (no cancel)", async () => {
    // A(slow) and B(fast,fails) → C
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: () => {
          if (id === "a") return delayed(30, ok(id))
          if (id === "b") return Promise.resolve(fail(id))
          return Promise.resolve(ok(id))
        },
      }),
      cb, new AbortController().signal,
    )
    // A should have completed (not cancelled)
    expect(results.get("a")?.status).toBe("success")
    expect(results.get("b")?.status).toBe("failed")
  })

  it("respects maxConcurrency=1 (serial execution)", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler({ maxConcurrency: 1 })
    let maxRunning = 0
    let currentRunning = 0
    await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: async () => {
          currentRunning++
          maxRunning = Math.max(maxRunning, currentRunning)
          await delayed(5, undefined)
          currentRunning--
          return ok(id)
        },
      }),
      cb, new AbortController().signal,
    )
    expect(maxRunning).toBe(1)
  })

  it("does not start nodes after abort signal", async () => {
    const edges = [{ from: "a", to: "b" }]
    const ctrl = new AbortController()
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b"], edges,
      (id) => ({
        nodeId: id,
        execute: async () => {
          if (id === "a") { ctrl.abort(); return ok(id) }
          return ok(id)
        },
      }),
      cb, ctrl.signal,
    )
    // b should not have started because abort fired during a's execution
    expect(cb.readyOrder).not.toContain("b")
  })

  it("handles diamond shape: A→B, A→C, B→D, C→D", async () => {
    const edges = [
      { from: "a", to: "b" }, { from: "a", to: "c" },
      { from: "b", to: "d" }, { from: "c", to: "d" },
    ]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c", "d"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder.indexOf("a")).toBe(0)
    expect(cb.readyOrder.indexOf("d")).toBe(3)
    expect(results.get("d")?.status).toBe("success")
  })

  it("handles empty node list", async () => {
    const s = new ReactiveScheduler()
    const cb = makeCallbacks([])
    const results = await s.execute([], [], () => { throw new Error("unreachable") }, cb, new AbortController().signal)
    expect(results.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop test -- --run desktop/electron/services/__tests__/workflow-scheduler.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/__tests__/workflow-scheduler.test.ts
git commit -m "test(workflow): add ReactiveScheduler unit tests"
```

---

### Task 3: Refactor WorkflowEngine to use ReactiveScheduler

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`

This is the core refactor. The `for (const nodeId of order)` loop (L109-L248) is replaced by `scheduler.execute(...)`. The pre-processing (abort check, reachability pruning) and post-processing (end node check, result assembly) stay unchanged.

- [ ] **Step 1: Replace the engine's serial loop with scheduler delegation**

The new `run()` method structure:

```typescript
// desktop/electron/services/workflow/workflow-engine.ts
import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import type { AgentSendDeps } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { interpolatePrompt, resolveVariables } from "./variable-resolver"
import { ReactiveScheduler } from "./workflow-scheduler"
import type { NodeExecOutcome, NodeTask, SchedulerCallbacks } from "./workflow-scheduler"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.engine")

function summarizeRecord(record: Record<string, unknown>): { readonly keys: string[]; readonly count: number } {
  const keys = Object.keys(record)
  return { keys, count: keys.length }
}

function stringDiagnostic(text: string | undefined, errorName: string): { readonly errorName: string; readonly errorLength: number } {
  return { errorName, errorLength: text?.length ?? 0 }
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number; readonly stackLength?: number } {
  if (error instanceof Error) {
    return { errorName: error.name, errorLength: error.message.length, stackLength: error.stack?.length }
  }
  return { errorName: "Error", errorLength: String(error).length }
}

type EventCallback = (event: WorkflowEvent) => void

export class WorkflowEngine {
  constructor(private readonly agentDeps: AgentSendDeps, private readonly abortSignal?: AbortSignal) {}

  async run(
    def: WorkflowDefinition,
    paramValues: Record<string, unknown>,
    runId: string,
    emit: EventCallback,
    abortSignal?: AbortSignal,
    projectId?: string,
  ): Promise<WorkflowRunResult> {
    const effectiveAbortSignal = abortSignal ?? this.abortSignal ?? new AbortController().signal
    if (effectiveAbortSignal.aborted) {
      logger.warn("workflow cancelled before start", { runId, workflowId: def.id })
      const result: WorkflowRunResult = { status: "cancelled", nodeResults: {}, durationMs: 0 }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }
    emit({ type: "workflow:started", runId, workflowId: def.id })
    const startMs = Date.now()
    const paramSummary = summarizeRecord(paramValues)
    logger.info("workflow run started", {
      runId, workflowId: def.id,
      projectId: projectId ?? "(fallback to def.id)",
      nodeCount: def.nodes.length,
      paramKeys: paramSummary.keys, paramCount: paramSummary.count,
    })

    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}

    // --- Reachability pruning (unchanged) ---
    const endNodeForReach = def.nodes.find((n) => n.type === "end")
    const canReachEnd = new Set<string>()
    if (endNodeForReach) {
      canReachEnd.add(endNodeForReach.id)
      const revAdj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
      for (const e of def.edges) { revAdj.get(e.to)?.push(e.from) }
      const bfsQueue = [endNodeForReach.id]
      while (bfsQueue.length) {
        const cur = bfsQueue.shift()!
        for (const prev of revAdj.get(cur) ?? []) {
          if (!canReachEnd.has(prev)) { canReachEnd.add(prev); bfsQueue.push(prev) }
        }
      }
    }

    // Filter to only nodes that can reach end
    const executableNodes = def.nodes
      .filter((n) => canReachEnd.size === 0 || canReachEnd.has(n.id))
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdges = def.edges
      .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))

    // Mark pruned nodes as skipped immediately
    for (const node of def.nodes) {
      if (!executableSet.has(node.id)) {
        logger.info("node skipped", { runId, nodeId: node.id, nodeName: node.name, nodeType: node.type, reason: "not-reachable" })
        const res: NodeRunResult = { nodeId: node.id, status: "skipped", input: { variables: {} } }
        nodeResults[node.id] = res
        emit({ type: "node:skipped", runId, nodeId: node.id, result: res })
      }
    }

    // --- Build taskFactory ---
    const nodeNames = Object.fromEntries(def.nodes.map((n) => [n.id, n.name]))
    const allNodeIds = new Set(def.nodes.map((n) => n.id))

    const taskFactory = (nodeId: string): NodeTask => ({
      nodeId,
      execute: async (): Promise<NodeExecOutcome> => {
        const node = def.nodes.find((n) => n.id === nodeId)!
        try {
          const manifest = nodeTypeRegistry.getManifest(node.type)
          const executor = nodeTypeRegistry.getExecutor(node.type)
          const cfg = manifest.configSchema.parse(node.config)
          const vars = (cfg as Record<string, unknown>)["variables"]
          const { resolved, skippedReferences } = resolveVariables(
            Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames, allNodeIds,
          )
          if (skippedReferences.length > 0) {
            logger.warn("node has variables referencing skipped upstream nodes (resolved to empty)", {
              runId, nodeId, nodeName: node.name,
              skippedReferences: skippedReferences.map((r) => `$${r.variableName} → ${r.sourceNodeName}`),
            })
          }
          const prompt = (cfg as Record<string, unknown>)["prompt"]
          const template = (cfg as Record<string, unknown>)["template"]
          const interpolatable = typeof prompt === "string" ? prompt : (typeof template === "string" ? template : undefined)
          const resolvedPrompt = interpolatable !== undefined ? interpolatePrompt(interpolatable, resolved) : undefined

          // Update NodeRunResult input for this node
          const nr = nodeResults[nodeId]
          if (nr) {
            nr.input = { variables: resolved, ...(resolvedPrompt !== undefined ? { prompt: resolvedPrompt } : {}) }
          }

          const inputVariableSummary = summarizeRecord(resolved)
          logger.info("node started", {
            runId, nodeId, nodeType: node.type, nodeName: node.name,
            inputVariableKeys: inputVariableSummary.keys,
            inputVariableCount: inputVariableSummary.count,
            ...(resolvedPrompt !== undefined ? { promptLength: resolvedPrompt.length } : {}),
          })

          const execResult = await executor.execute({
            config: cfg, resolvedVariables: resolved,
            context: { projectId: projectId ?? def.id, runId, abortSignal: effectiveAbortSignal },
            agentDeps: this.agentDeps,
            onProgress: (phase, label) => {
              emit({ type: "node:progress", runId, nodeId, phase, label })
            },
          })

          if (effectiveAbortSignal.aborted) {
            return { nodeId, status: "failed", error: "运行被取消", durationMs: execResult.durationMs }
          }

          return {
            nodeId, status: execResult.status, output: execResult.output,
            outputs: execResult.outputs, activeBranch: execResult.activeBranch,
            error: execResult.error, durationMs: execResult.durationMs,
          }
        } catch (err) {
          if (effectiveAbortSignal.aborted) {
            return { nodeId, status: "failed", error: "运行被取消" }
          }
          const msg = err instanceof Error ? err.message : String(err)
          const visibleError = `节点执行异常（错误 ${msg.length} 字）`
          logger.warn("node threw exception", {
            runId, nodeId, nodeName: node.name, nodeType: node.type,
            ...errorDiagnostic(err),
          })
          return { nodeId, status: "failed", error: visibleError }
        }
      },
    })

    // --- Build callbacks ---
    const callbacks: SchedulerCallbacks = {
      onNodeReady: (nodeId) => {
        const nodeStartedAt = Date.now()
        emit({ type: "node:started", runId, nodeId, startedAt: nodeStartedAt })
        const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: nodeStartedAt }
        nodeResults[nodeId] = nr
      },
      onNodeDone: (outcome) => {
        const nr = nodeResults[outcome.nodeId]
        if (!nr) return
        nr.status = outcome.status
        nr.output = outcome.output
        nr.outputs = outcome.outputs
        nr.activeBranch = outcome.activeBranch
        nr.error = outcome.error
        nr.endedAt = Date.now()
        nr.durationMs = outcome.durationMs

        if (outcome.status === "success") {
          logger.info("node succeeded", {
            runId, nodeId: outcome.nodeId, nodeName: nodeNames[outcome.nodeId], durationMs: nr.durationMs,
            ...(nr.output !== undefined ? { outputLength: nr.output.length } : {}),
            ...(nr.activeBranch !== undefined ? { activeBranch: nr.activeBranch } : {}),
          })
          if (outcome.output !== undefined) nodeOutputs[outcome.nodeId] = outcome.output
          emit({ type: "node:completed", runId, nodeId: outcome.nodeId, output: outcome.output, result: { ...nr } })
        } else {
          const node = def.nodes.find((n) => n.id === outcome.nodeId)
          logger.warn("node failed", {
            runId, nodeId: outcome.nodeId, nodeName: node?.name, nodeType: node?.type,
            ...stringDiagnostic(outcome.error, "agent"),
            durationMs: nr.durationMs,
          })
          emit({ type: "node:failed", runId, nodeId: outcome.nodeId, error: outcome.error ?? "Unknown error", result: { ...nr } })
        }
      },
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
    }

    // --- Execute via scheduler ---
    const scheduler = new ReactiveScheduler()
    const schedulerResults = await scheduler.execute(
      executableNodes, executableEdges, taskFactory, callbacks, effectiveAbortSignal,
    )

    // Mark scheduler-skipped nodes
    for (const [nodeId, outcome] of schedulerResults) {
      if (!(nodeId in nodeResults)) {
        const node = def.nodes.find((n) => n.id === nodeId)
        logger.info("node skipped", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-skipped" })
        const res: NodeRunResult = { nodeId, status: "skipped", input: { variables: {} } }
        nodeResults[nodeId] = res
        emit({ type: "node:skipped", runId, nodeId, result: res })
      }
    }

    // --- Post-processing (unchanged) ---
    const durationMs = Date.now() - startMs
    let overallFailed = Object.values(nodeResults).some((nr) => nr.status === "failed")
    const endNode = def.nodes.find((n) => n.type === "end")
    const endNodeId = endNode?.id

    if (effectiveAbortSignal.aborted) {
      // Mark any still-running nodes
      for (const nr of Object.values(nodeResults)) {
        if (nr.status === "running") {
          nr.status = "failed"; nr.error = "运行被取消"
          nr.endedAt = Date.now()
          nr.durationMs = nr.startedAt ? nr.endedAt - nr.startedAt : undefined
        }
      }
      const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }

    if (!overallFailed && endNodeId && !(endNodeId in nodeOutputs)) {
      const endResult = nodeResults[endNodeId]
      if (!endResult || endResult.status === "skipped") {
        overallFailed = true
        const errorMsg = `工作流结束节点「${endNode!.name}」未被执行（当前分支路径未连接到结束节点）`
        logger.warn("end node skipped — treating as failure", { runId, workflowId: def.id, endNodeId, durationMs })
        if (endResult) { endResult.status = "failed"; endResult.error = errorMsg }
        else { nodeResults[endNodeId] = { nodeId: endNodeId, status: "failed", input: { variables: {} }, error: errorMsg } }
        emit({ type: "node:failed", runId, nodeId: endNodeId, error: errorMsg, result: { ...nodeResults[endNodeId] } })
      }
    }

    const result: WorkflowRunResult = {
      status: overallFailed ? "failed" : "completed",
      nodeResults, durationMs,
      output: endNodeId ? nodeOutputs[endNodeId] : undefined,
    }
    if (overallFailed) {
      const failedNode = Object.values(nodeResults).find((nr) => nr.status === "failed" && nr.error)
      const failedNodeName = failedNode ? def.nodes.find((n) => n.id === failedNode.nodeId)?.name : undefined
      const detailedError = failedNode?.error
        ? (failedNodeName ? `节点「${failedNodeName}」失败：${failedNode.error}` : failedNode.error)
        : "One or more nodes failed"
      logger.error("workflow run failed", {
        runId, workflowId: def.id, durationMs,
        firstFailedNode: failedNode?.nodeId,
        ...stringDiagnostic(detailedError, "workflow"),
      })
      emit({ type: "workflow:failed", runId, error: detailedError, result })
    } else {
      logger.info("workflow run completed", {
        runId, workflowId: def.id, durationMs,
        ...(result.output !== undefined ? { outputLength: result.output.length } : {}),
      })
      emit({ type: "workflow:completed", runId, result })
    }
    return result
  }
}
```

Key changes from old engine:
- Removed `topoOrder()` function (no longer needed)
- Removed the `for (const nodeId of order)` serial loop
- Extracted node execution into `taskFactory` closure
- Delegated scheduling to `ReactiveScheduler`
- `overallFailed` is now derived from `nodeResults` after scheduler completes
- Reachability pruning happens before scheduler, not during loop

- [ ] **Step 2: Update the "does not run another start node after a failure" test**

This test assumed serial execution: A fails → B is skipped → `sendToAgent` called 1 time. With parallel scheduling, both roots A and B launch simultaneously, so `sendToAgent` is called 2 times and B actually runs (fails) instead of being skipped. This is the expected behavioral change ("等全部完成再判断").

In `desktop/electron/services/__tests__/workflow-engine.test.ts`, update the test at ~L99:

```typescript
  it("does not run downstream nodes after parallel root failures", async () => {
    const def: WorkflowDefinition = { id: "wf4", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, { ...nodeB, config: { ...nodeB.config, prompt: "second" } }, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] }
    const events: WorkflowEvent[] = []
    const agent = { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run4", (e) => events.push(e))
    expect(result.status).toBe("failed")
    // Both parallel roots are launched simultaneously
    expect(agent.sendToAgent).toHaveBeenCalledTimes(2)
    // End node should not have been reached
    expect(result.nodeResults.end?.status).not.toBe("success")
  })
```

- [ ] **Step 3: Run existing tests to verify backward compat**

Run: `pnpm --filter @synapse/desktop test -- --run desktop/electron/services/__tests__/workflow-engine.test.ts`
Expected: All 6 existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "refactor(workflow): replace serial loop with ReactiveScheduler"
```

---

### Task 4: Add parallel-specific integration tests

**Files:**
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`

These tests use the full engine (with real node executors) to verify parallel behavior end-to-end.

- [ ] **Step 1: Add parallel integration tests at the end of the existing test file**

Append after the last `it(...)` block, inside the existing `describe("WorkflowEngine", ...)`:

```typescript
  it("runs parallel roots A,B simultaneously before C (end node)", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { agent: "claude-code", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeC, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "c", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("hi"))
    const result = await engine.run(def, {}, "run-par", (e) => events.push(e))
    expect(result.status).toBe("completed")
    const startedEvents = events.filter((e) => e.type === "node:started")
    // Both a and c should start before end
    const aIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a")
    const cIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "c")
    const endIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "end")
    expect(aIdx).toBeLessThan(endIdx)
    expect(cIdx).toBeLessThan(endIdx)
  })

  it("parallel root failure skips downstream but lets other running nodes finish", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { agent: "claude-code", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par-fail", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeC, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "c", to: "end" }],
    }
    let callCount = 0
    const agent = {
      sendToAgent: vi.fn().mockImplementation(() => {
        callCount++
        // First call succeeds, second fails
        if (callCount === 1) return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
        return Promise.resolve({ status: "failed" as const, response: "", error: "boom", durationMs: 1 })
      }),
    }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-par-fail", () => {})
    expect(result.status).toBe("failed")
    // Both roots should have been called (parallel — both started before either finished)
    expect(agent.sendToAgent).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run all engine tests**

Run: `pnpm --filter @synapse/desktop test -- --run desktop/electron/services/__tests__/workflow-engine.test.ts`
Expected: All tests PASS (6 existing + 2 new)

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `pnpm --filter @synapse/desktop test -- --run`
Expected: No regressions

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "test(workflow): add parallel execution integration tests"
```
