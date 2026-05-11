# Workflow Module Full-Chain Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive `StructuredLogger` logging to the workflow module's three main-process layers (IPC, Service, Engine) so that a complete operation history and node-level state changes are captured in the Electron log file for debugging.

**Architecture:** Module-level `const logger = createMainLogger(category)` in each file, matching the existing codebase pattern. No constructor changes, no new files. All logs go to the existing `logStore` log file under `userData/logs/`. Node execution logs include full input variables, interpolated prompt (truncated to 200 chars), and output (truncated to 500 chars).

**Tech Stack:** `createMainLogger` from `electron/services/log-store.ts`, `StructuredLogger` interface, vitest for regression verification.

---

## File Map

| File | Change | Logger category |
|------|--------|----------------|
| `desktop/electron/services/workflow/workflow-service.ts` | Add logger + calls | `service.workflow` |
| `desktop/electron/services/workflow/workflow-engine.ts` | Add logger + calls | `service.workflow.engine` |
| `desktop/electron/modules/workflow/ipc.ts` | Add logger + calls | `workflow.ipc` |

No other files touched.

---

## Task 1: WorkflowService logging

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-service.ts`

- [ ] **Step 1: Verify baseline tests pass**

```bash
pnpm --filter @synapse/desktop run test -- --reporter=verbose desktop/electron/services/__tests__/workflow-service.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 2: Add logger import and module-level instance**

In `workflow-service.ts`, add after the last existing import line:

```ts
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow")
```

- [ ] **Step 3: Add logging to `list()`**

Replace the existing `list()` method body:

```ts
async list(): Promise<WorkflowMeta[]> {
  let ids: string[]
  try { ids = await readdir(path.join(this.repoPath, "workflows")) } catch { return [] }
  const metas: WorkflowMeta[] = []
  for (const id of ids) {
    const def = await this.get(id)
    if (def) metas.push({ id: def.id, name: def.name, description: def.description, version: def.version, nodeCount: def.nodes.length, createdAt: def.createdAt, updatedAt: def.updatedAt })
  }
  logger.info("workflow list loaded", { count: metas.length })
  return metas
}
```

- [ ] **Step 4: Add logging to `get()`**

Replace the existing `get()` method body:

```ts
async get(id: string): Promise<WorkflowDefinition | null> {
  let files: string[]
  try { files = await readdir(this.dir(id)) } catch {
    logger.info("workflow get: not found", { id })
    return null
  }
  const versions = files.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
  if (!versions.length) {
    logger.info("workflow get: no versions", { id })
    return null
  }
  const versionFile = versions[versions.length - 1]
  logger.info("workflow get: loaded", { id, versionFile })
  return JSON.parse(await readFile(path.join(this.dir(id), versionFile), "utf-8")) as WorkflowDefinition
}
```

- [ ] **Step 5: Add logging to `save()`**

Replace the existing `save()` method body:

```ts
async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
  const versionHash = this.versionHash(def)
  const versioned: WorkflowDefinition = { ...def, version: versionHash, updatedAt: Date.now() }
  await mkdir(this.dir(def.id), { recursive: true })
  await writeFile(path.join(this.dir(def.id), `${versionHash}.json`), JSON.stringify(versioned, null, 2), "utf-8")
  logger.info("workflow saved", { id: def.id, name: def.name, nodeCount: def.nodes.length, versionHash })
  return { versionHash }
}
```

- [ ] **Step 6: Add logging to `create()`**

Replace the existing `create()` method body:

```ts
async create(): Promise<{ id: string; versionHash: string } | WorkflowSaveError> {
  const id = randomUUID()
  const now = Date.now()
  const def: WorkflowDefinition = {
    id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [],
    nodes: [{ id: randomUUID(), name: "结束", type: "end", position: { x: 600, y: 200 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
  logger.info("workflow creating", { id, name: def.name })
  const result = await this.save(def)
  if ("errors" in result) {
    logger.warn("workflow create failed", { id, errors: result.errors })
    return result
  }
  logger.info("workflow created", { id, name: def.name, versionHash: result.versionHash })
  return { id, ...result }
}
```

- [ ] **Step 7: Add logging to `delete()`**

Replace the existing `delete()` method body:

```ts
async delete(id: string): Promise<void> {
  logger.info("workflow deleting", { id })
  try {
    await rm(this.dir(id), { recursive: true, force: true })
    logger.info("workflow deleted", { id })
  } catch (err) {
    logger.warn("workflow delete error", { id, error: err instanceof Error ? err.message : String(err) })
  }
}
```

- [ ] **Step 8: Run tests to verify no regression**

```bash
pnpm --filter @synapse/desktop run test -- --reporter=verbose desktop/electron/services/__tests__/workflow-service.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services/workflow/workflow-service.ts
git commit -m "feat(workflow): add StructuredLogger to WorkflowService"
```

---

## Task 2: WorkflowEngine logging

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`

- [ ] **Step 1: Verify baseline tests pass**

```bash
pnpm --filter @synapse/desktop run test -- --reporter=verbose desktop/electron/services/__tests__/workflow-engine.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 2: Add logger import and helpers**

Add after the last existing import line in `workflow-engine.ts`:

```ts
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.engine")

function truncate(text: string | undefined, maxLen: number): string | undefined {
  if (!text) return text
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...(truncated)`
}
```

- [ ] **Step 3: Log run lifecycle — pre-start abort, run started, run complete/fail/cancel**

Replace the `run()` method with the fully-logged version. The complete new method:

```ts
async run(
  def: WorkflowDefinition,
  paramValues: Record<string, unknown>,
  runId: string,
  emit: EventCallback,
  abortSignal?: AbortSignal,
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
  const reachableSet = reachableFromEnd(def)
  const order = topoOrder(def).filter((id) => reachableSet.has(id))
  logger.info("workflow run started", { runId, workflowId: def.id, nodeCount: def.nodes.length, reachableCount: order.length, params: paramValues })
  const nodeResults: Record<string, NodeRunResult> = {}
  const nodeOutputs: Record<string, string> = {}
  let overallFailed = false
  const reachableNodes = new Set<string>(
    def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id)).map((n) => n.id)
  )

  for (const nodeId of order) {
    if (effectiveAbortSignal.aborted) {
      logger.warn("workflow cancelled mid-run", { runId, workflowId: def.id, durationMs: Date.now() - startMs })
      const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }
    const node = def.nodes.find((n) => n.id === nodeId)!
    const incomingEdges = def.edges.filter((e) => e.to === nodeId)
    const ancestors = incomingEdges.map((e) => e.from)

    const shouldSkip =
      overallFailed ||
      (ancestors.length > 0 && !reachableNodes.has(nodeId))
    if (shouldSkip) {
      const reason = overallFailed ? "overall-failed" : "not-reachable"
      logger.info("node skipped", { runId, nodeId, nodeName: node.name, nodeType: node.type, reason })
      const res: NodeRunResult = { nodeId, status: "skipped", input: { variables: {} } }
      nodeResults[nodeId] = res
      emit({ type: "node:skipped", runId, nodeId, result: res })
      continue
    }
    emit({ type: "node:started", runId, nodeId })
    const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: Date.now() }
    nodeResults[nodeId] = nr

    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const executor = nodeTypeRegistry.getExecutor(node.type)
      const cfg = manifest.configSchema.parse(node.config)
      const vars = (cfg as Record<string, unknown>)["variables"]
      const nodeNames = Object.fromEntries(def.nodes.map((n) => [n.id, n.name]))
      const resolved = resolveVariables(Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames)
      const prompt = (cfg as Record<string, unknown>)["prompt"]
      nr.input = {
        variables: resolved,
        ...(typeof prompt === "string" ? { prompt: interpolatePrompt(prompt, resolved) } : {}),
      }

      logger.info("node started", {
        runId, nodeId, nodeType: node.type, nodeName: node.name,
        inputVariables: resolved,
        ...(nr.input.prompt !== undefined ? { prompt: truncate(nr.input.prompt, 200) } : {}),
      })

      const execResult = await executor.execute({
        config: cfg, resolvedVariables: resolved,
        context: { projectId: def.id, runId, abortSignal: effectiveAbortSignal },
        agentDeps: this.agentDeps,
      })
      if (effectiveAbortSignal.aborted) {
        logger.warn("node aborted mid-execution", { runId, nodeId, nodeName: node.name })
        const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
        emit({ type: "workflow:cancelled", runId, result })
        return result
      }
      nr.status = execResult.status; nr.output = execResult.output; nr.outputs = execResult.outputs
      nr.activeBranch = execResult.activeBranch; nr.error = execResult.error
      nr.endedAt = Date.now(); nr.durationMs = execResult.durationMs

      if (execResult.status === "success") {
        logger.info("node succeeded", {
          runId, nodeId, nodeName: node.name, durationMs: nr.durationMs,
          ...(nr.output !== undefined ? { outputPreview: truncate(nr.output, 500) } : {}),
          ...(nr.activeBranch !== undefined ? { activeBranch: nr.activeBranch } : {}),
        })
        nodeOutputs[nodeId] = execResult.output
        emit({ type: "node:completed", runId, nodeId, output: execResult.output, result: { ...nr } })
        for (const e of def.edges.filter((e) => e.from === nodeId)) {
          if (!execResult.activeBranch || e.branch === execResult.activeBranch) {
            reachableNodes.add(e.to)
            emit({ type: "edge:activated", runId, from: e.from, to: e.to })
          }
        }
      } else {
        logger.warn("node failed", {
          runId, nodeId, nodeName: node.name, nodeType: node.type, error: execResult.error, durationMs: nr.durationMs,
          inputVariables: nr.input.variables,
          ...(nr.input.prompt !== undefined ? { prompt: truncate(nr.input.prompt, 200) } : {}),
        })
        overallFailed = true
        emit({ type: "node:failed", runId, nodeId, error: execResult.error ?? "Unknown error", result: { ...nr } })
      }
    } catch (err) {
      if (effectiveAbortSignal.aborted) {
        logger.warn("node aborted mid-execution (exception path)", { runId, nodeId, nodeName: node.name })
        const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
        emit({ type: "workflow:cancelled", runId, result })
        return result
      }
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn("node threw exception", {
        runId, nodeId, nodeName: node.name, nodeType: node.type, error: msg,
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      })
      nr.status = "failed"; nr.error = msg; nr.endedAt = Date.now()
      nr.durationMs = nr.startedAt ? nr.endedAt - nr.startedAt : undefined
      overallFailed = true
      emit({ type: "node:failed", runId, nodeId, error: msg, result: { ...nr } })
    }
  }

  const durationMs = Date.now() - startMs
  const endNodeId = def.nodes.find((n) => n.type === "end")?.id
  const result: WorkflowRunResult = {
    status: overallFailed ? "failed" : "completed",
    nodeResults, durationMs,
    output: endNodeId ? nodeOutputs[endNodeId] : undefined,
  }
  if (overallFailed) {
    logger.error("workflow run failed", { runId, workflowId: def.id, durationMs })
    emit({ type: "workflow:failed", runId, error: "One or more nodes failed", result })
  } else {
    logger.info("workflow run completed", {
      runId, workflowId: def.id, durationMs,
      ...(result.output !== undefined ? { outputPreview: truncate(result.output, 500) } : {}),
    })
    emit({ type: "workflow:completed", runId, result })
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify no regression**

```bash
pnpm --filter @synapse/desktop run test -- --reporter=verbose desktop/electron/services/__tests__/workflow-engine.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts
git commit -m "feat(workflow): add StructuredLogger to WorkflowEngine"
```

---

## Task 3: IPC layer logging

**Files:**
- Modify: `desktop/electron/modules/workflow/ipc.ts`

No test file exists for the IPC module (tested via integration). Verify via TypeScript type-check.

- [ ] **Step 1: Verify TypeScript baseline**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: exits 0 (or same error count as before — note any pre-existing errors).

- [ ] **Step 2: Add logger import and module-level instance**

Add after the last existing import line in `electron/modules/workflow/ipc.ts`:

```ts
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("workflow.ipc")
```

- [ ] **Step 3: Add logging to `list`, `get`, `create`, `save`, `delete`, `validate` handlers**

Replace the `methods` block's `list`, `get`, `create`, `save`, `delete`, and `validate` handlers:

```ts
list: {
  channel: "synapse:workflow:list", kind: "invoke", request: z.void().optional(),
  response: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), version: z.string(), nodeCount: z.number(), createdAt: z.number(), updatedAt: z.number() })),
  handler: async (ctx) => {
    const result = await ctx.resolve<WorkflowService>("core.workflow").list()
    logger.info("workflow:list", { count: result.length })
    return result
  },
},
get: {
  channel: "synapse:workflow:get", kind: "invoke", request: z.object({ id: z.string() }),
  response: workflowDefinitionSchema.nullable(),
  handler: async (ctx, { id }: { id: string }) => {
    logger.info("workflow:get", { id })
    const result = await ctx.resolve<WorkflowService>("core.workflow").get(id)
    if (!result) logger.info("workflow:get not found", { id })
    return result
  },
},
create: {
  channel: "synapse:workflow:create", kind: "invoke", request: z.void().optional(),
  response: z.union([
    z.object({ id: z.string(), versionHash: z.string() }),
    z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
  ]),
  handler: async (ctx) => {
    logger.info("workflow:create requested")
    const result = await ctx.resolve<WorkflowService>("core.workflow").create()
    if ("errors" in result) {
      logger.warn("workflow:create failed", { errors: result.errors })
    } else {
      logger.info("workflow:create succeeded", { id: result.id, versionHash: result.versionHash })
    }
    return result
  },
},
save: {
  channel: "synapse:workflow:save", kind: "invoke", request: workflowDefinitionSchema,
  response: z.union([z.object({ versionHash: z.string() }), z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) })]),
  handler: async (ctx, def) => {
    const d = def as { id: string; name: string; nodes: unknown[] }
    logger.info("workflow:save requested", { id: d.id, name: d.name, nodeCount: d.nodes.length })
    const result = await ctx.resolve<WorkflowService>("core.workflow").save(def as never)
    if ("errors" in result) {
      logger.warn("workflow:save failed", { id: d.id, errors: result.errors })
    } else {
      logger.info("workflow:save succeeded", { id: d.id, versionHash: result.versionHash })
    }
    return result
  },
},
delete: {
  channel: "synapse:workflow:delete", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
  handler: async (ctx, { id }: { id: string }) => {
    logger.info("workflow:delete requested", { id })
    await ctx.resolve<WorkflowService>("core.workflow").delete(id)
    logger.info("workflow:delete done", { id })
  },
},
validate: {
  channel: "synapse:workflow:validate", kind: "invoke", request: workflowDefinitionSchema, response: validationResultSchema,
  handler: async (_ctx, def) => {
    const d = def as { id: string; nodes: unknown[] }
    logger.info("workflow:validate requested", { id: d.id, nodeCount: d.nodes.length })
    const result = validateWorkflow(def as never)
    logger.info("workflow:validate result", { id: d.id, valid: result.valid, errorCount: result.errors.length, warnCount: result.warnings.length })
    if (!result.valid) logger.warn("workflow:validate errors", { id: d.id, errors: result.errors })
    return result
  },
},
```

- [ ] **Step 4: Add logging to `run` handler**

Replace the `run` handler (keep all existing logic, add logger calls at start and after `runId` is assigned):

```ts
run: {
  channel: "synapse:workflow:run", kind: "invoke",
  request: z.object({ id: z.string(), params: z.record(z.string(), z.unknown()) }),
  response: z.object({ runId: z.string() }),
  handler: async (ctx, { id, params }: { id: string; params: Record<string, unknown> }) => {
    logger.info("workflow:run requested", { workflowId: id, paramKeys: Object.keys(params) })
    const svc = ctx.resolve<WorkflowService>("core.workflow")
    const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
    const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
    const eventBus = ctx.resolve<EventBus>("core.event-bus")
    const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
    const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

    const def = await svc.get(id)
    if (!def) {
      logger.error("workflow:run failed - not found", { workflowId: id })
      throw new Error(`Workflow ${id} not found`)
    }

    const ac = new AbortController()
    const runId = randomUUID()
    const startedAt = Date.now()
    abortMap.set(runId, ac)
    runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt })

    logger.info("workflow:run started", { workflowId: id, runId, workflowName: def.name, nodeCount: def.nodes.length })

    void engine.run(def, params, runId, (event) => {
      const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
      const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
      if (event.type === "node:started") {
        nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running" }
      } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
        nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
      }
      runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })

      eventBus.emit(
        { domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() },
        { backpressure: "block" },
      )
      if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
        abortMap.delete(runId)
        const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
        const endedAt = Date.now()
        const nodeResults = event.result?.nodeResults ?? nextNodeResults
        const durationMs = event.result?.durationMs ?? endedAt - startedAt
        logger.info("workflow:run finished", { workflowId: id, runId, status, durationMs })
        runStatuses.set(runId, {
          ...current,
          runId,
          workflowId: id,
          status,
          nodeResults,
          startedAt,
          endedAt,
          durationMs,
          ...(event.type === "workflow:failed" ? { error: event.error } : {}),
        })
        void snapshots.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params, nodeResults })
      }
    }, ac.signal)

    return { runId }
  },
},
```

- [ ] **Step 5: Add logging to `cancel` and `openEditor` handlers**

Replace the `cancel` and `openEditor` handlers:

```ts
cancel: {
  channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: z.string() }), response: z.void(),
  handler: (ctx, { runId }: { runId: string }) => {
    logger.info("workflow:cancel requested", { runId })
    ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts").get(runId)?.abort()
    logger.info("workflow:cancel signal sent", { runId })
  },
},
```

```ts
openEditor: {
  channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: z.string(), runId: z.string().optional() }), response: z.void(),
  handler: (ctx, { id, runId }: { id: string; runId?: string }) => {
    logger.info("workflow:openEditor", { workflowId: id, runId })
    const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
    ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").open(id, baseUrl, runId)
  },
},
```

- [ ] **Step 6: Run TypeScript type-check**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: exits 0 (or same pre-existing error count as Step 1 baseline).

- [ ] **Step 7: Run all workflow tests**

```bash
pnpm --filter @synapse/desktop run test -- --reporter=verbose desktop/electron/services/__tests__/workflow-service.test.ts desktop/electron/services/__tests__/workflow-engine.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/workflow/ipc.ts
git commit -m "feat(workflow): add StructuredLogger to workflow IPC handlers"
```

---

## Verification

After all three tasks are complete, manually trigger a workflow run in the app and check the log file:

```bash
# Find the latest log file
ls -lt ~/Library/Application\ Support/Synapse/logs/ | head -5

# Search for workflow logs
grep "workflow\." ~/Library/Application\ Support/Synapse/logs/<latest>.log | head -30
```

You should see a sequence of entries like:
```
... INFO [workflow.ipc] workflow:run requested { workflowId: "...", paramKeys: [] }
... INFO [service.workflow] workflow get: loaded { id: "...", versionFile: "v_..." }
... INFO [workflow.ipc] workflow:run started { runId: "...", workflowName: "..." }
... INFO [service.workflow.engine] workflow run started { runId: "...", nodeCount: 3 }
... INFO [service.workflow.engine] node started { runId: "...", nodeType: "llm", ... }
... INFO [service.workflow.engine] node succeeded { runId: "...", durationMs: 1240, ... }
... INFO [service.workflow.engine] workflow run completed { runId: "...", durationMs: 1245 }
... INFO [workflow.ipc] workflow:run finished { status: "completed", durationMs: 1250 }
```
