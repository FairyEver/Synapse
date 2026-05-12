import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WorkflowService } from "../../services/workflow/workflow-service"
import type { WorkflowEngine } from "../../services/workflow/workflow-engine"
import type { RunSnapshotService } from "../../services/workflow/run-snapshot-service"
import type { WorkflowWindowManager } from "../../services/workflow/window-manager"
import type { EventBus } from "../../runtime/event-bus"
import { validateWorkflow } from "../../services/workflow/workflow-validator"
import type { NodeRunResult, WorkflowRunStatus } from "../../../src/types/workflow"
import { createMainLogger } from "../../services/log-store"
import { configStore } from "../../services/config-store"

const logger = createMainLogger("workflow.ipc")

/**
 * Maximum number of terminal (completed/failed/cancelled) run statuses to keep
 * per workflow in the in-memory map. Older entries are pruned to prevent
 * unbounded memory growth during long sessions.
 */
const MAX_TERMINAL_STATUSES_PER_WORKFLOW = 5

/**
 * Prune old terminal run statuses for a given workflow, keeping only the most
 * recent MAX_TERMINAL_STATUSES_PER_WORKFLOW entries. Running entries are never pruned.
 */
function pruneTerminalStatuses(runStatuses: Map<string, WorkflowRunStatus>, workflowId: string): void {
  const terminalEntries: Array<{ runId: string; endedAt: number }> = []
  for (const [runId, status] of runStatuses) {
    if (status.workflowId === workflowId && status.status !== "running") {
      terminalEntries.push({ runId, endedAt: status.endedAt ?? status.startedAt })
    }
  }
  if (terminalEntries.length <= MAX_TERMINAL_STATUSES_PER_WORKFLOW) return
  // Sort oldest first, prune excess
  terminalEntries.sort((a, b) => a.endedAt - b.endedAt)
  const toRemove = terminalEntries.slice(0, terminalEntries.length - MAX_TERMINAL_STATUSES_PER_WORKFLOW)
  for (const { runId } of toRemove) {
    runStatuses.delete(runId)
  }
  logger.info("pruned stale run statuses", { workflowId, removed: toRemove.length, remaining: terminalEntries.length - toRemove.length })
}

const workflowDefinitionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  params: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]), default: z.union([z.string(), z.number(), z.null()]), description: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), config: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() })),
})

const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })),
  warnings: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), message: z.string() })),
})

export const workflowIpcModule: IpcModule = {
  id: "workflow",
  methods: {
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
        // Validation is performed inside WorkflowService.save() — no need to validate here.
        const result = await ctx.resolve<WorkflowService>("core.workflow").save(def as never)
        if ("errors" in result) {
          logger.warn("workflow:save blocked by validation", { id: d.id, errors: result.errors })
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
        // Abort any running runs for this workflow before deleting to prevent
        // orphaned engine processes (which would otherwise continue running,
        // leak abort controllers / run statuses in memory, and write ghost
        // snapshot files to the deleted workflow directory on completion).
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        let abortedCount = 0
        for (const [runId, status] of runStatuses) {
          if (status.workflowId === id && status.status === "running") {
            abortMap.get(runId)?.abort()
            runStatuses.delete(runId)
            abortMap.delete(runId)
            abortedCount++
          }
        }
        if (abortedCount > 0) {
          logger.info("workflow:delete aborted running runs", { workflowId: id, abortedCount })
        }
        await ctx.resolve<WorkflowService>("core.workflow").delete(id)
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").forceCloseAll(id)
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
    run: {
      channel: "synapse:workflow:run", kind: "invoke",
      request: z.object({ id: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
      ]),
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

        // Validate before running — prevents invalid workflows from executing
        // when triggered from paths that skip editor-side validation (e.g. list page "Run" button)
        const validation = validateWorkflow(def)
        if (!validation.valid) {
          logger.warn("workflow:run blocked by validation", { workflowId: id, errors: validation.errors })
          return { errors: validation.errors }
        }

        const ac = new AbortController()
        const runId = randomUUID()
        const startedAt = Date.now()
        abortMap.set(runId, ac)
        runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, params, definition: def })

        // Resolve the active project ID for the runtime context
        const appConfig = await configStore.load()
        const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
        const projectId = activeRepo?.uuid ?? ""

        logger.info("workflow:run started", { workflowId: id, runId, workflowName: def.name, nodeCount: def.nodes.length, projectId })

        engine.run(def, params, runId, (event) => {
          const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
          const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
          if (event.type === "node:started") {
            nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
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
              definition: def,
              ...(event.type === "workflow:failed" ? { error: event.error } : {}),
            })
            void snapshots.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params, nodeResults, definition: def })
            pruneTerminalStatuses(runStatuses, id)
          }
        }, ac.signal, projectId).catch((err) => {
          // Guard against unhandled rejection: if the engine throws before emitting
          // a terminal event, the run would be stuck at "running" forever. Catch the
          // rejection, update status to "failed", and emit workflow:failed so the
          // renderer can recover.
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error("workflow engine rejected unexpectedly", { workflowId: id, runId, error: errorMsg, stack: err instanceof Error ? err.stack : undefined })
          abortMap.delete(runId)
          const current = runStatuses.get(runId)
          // Only recover if the run hasn't already reached a terminal state
          // (the engine might have emitted workflow:failed before throwing)
          if (current && current.status === "running") {
            const endedAt = Date.now()
            const durationMs = endedAt - startedAt
            const failedStatus = {
              runId,
              workflowId: id,
              status: "failed" as const,
              nodeResults: current.nodeResults,
              startedAt,
              endedAt,
              durationMs,
              error: `引擎异常：${errorMsg}`,
            }
            runStatuses.set(runId, failedStatus)
            eventBus.emit(
              { domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, error: failedStatus.error, result: { status: "failed", nodeResults: current.nodeResults, durationMs } }, timestamp: new Date().toISOString() },
              { backpressure: "block" },
            )
            void snapshots.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status: "failed", params, nodeResults: current.nodeResults, definition: def })
          }
        })

        return { runId }
      },
    },
    runDefinition: {
      channel: "synapse:workflow:run-definition", kind: "invoke",
      request: z.object({ definition: workflowDefinitionSchema, params: z.record(z.string(), z.unknown()), force: z.boolean().optional() }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { definition: rawDef, params, force }: { definition: unknown; params: Record<string, unknown>; force?: boolean }) => {
        const def = rawDef as import("../../../src/types/workflow").WorkflowDefinition
        logger.info("workflow:runDefinition requested", { workflowId: def.id, paramKeys: Object.keys(params) })
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

        const validation = validateWorkflow(def)
        if (!validation.valid) {
          logger.warn("workflow:runDefinition blocked by validation", { workflowId: def.id, errors: validation.errors })
          return { errors: validation.errors }
        }

        if (!force) {
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === def.id && status.status === "running") {
              logger.info("workflow:runDefinition conflict", { workflowId: def.id, activeRunId: existingRunId })
              return { conflict: true as const, activeRunId: existingRunId }
            }
          }
        } else {
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === def.id && status.status === "running") {
              logger.info("workflow:runDefinition force — cancelling active run", { activeRunId: existingRunId })
              abortMap.get(existingRunId)?.abort()
            }
          }
        }

        const ac = new AbortController()
        const runId = randomUUID()
        const startedAt = Date.now()
        abortMap.set(runId, ac)
        runStatuses.set(runId, { runId, workflowId: def.id, status: "running", nodeResults: {}, startedAt, params, definition: def })

        const appConfig = await configStore.load()
        const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
        const projectId = activeRepo?.uuid ?? ""

        logger.info("workflow:runDefinition started", { workflowId: def.id, runId, nodeCount: def.nodes.length })

        engine.run(def, params, runId, (event) => {
          const current = runStatuses.get(runId) ?? { runId, workflowId: def.id, status: "running" as const, nodeResults: {}, startedAt, definition: def }
          const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
          if (event.type === "node:started") {
            nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
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
            runStatuses.set(runId, { ...current, runId, workflowId: def.id, status, nodeResults, startedAt, endedAt, durationMs, definition: def, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
            void snapshots.save({ runId, workflowId: def.id, version: def.version, startedAt, endedAt, status, params, nodeResults, definition: def })
            pruneTerminalStatuses(runStatuses, def.id)
          }
        }, ac.signal, projectId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error("workflow engine rejected (runDefinition)", { workflowId: def.id, runId, error: errorMsg })
          abortMap.delete(runId)
          const current = runStatuses.get(runId)
          if (current && current.status === "running") {
            const endedAt = Date.now()
            const durationMs = endedAt - startedAt
            runStatuses.set(runId, { runId, workflowId: def.id, status: "failed", nodeResults: current.nodeResults, startedAt, endedAt, durationMs, error: `引擎异常：${errorMsg}`, definition: def })
            eventBus.emit(
              { domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, error: `引擎异常：${errorMsg}`, result: { status: "failed", nodeResults: current.nodeResults, durationMs } }, timestamp: new Date().toISOString() },
              { backpressure: "block" },
            )
            void snapshots.save({ runId, workflowId: def.id, version: def.version, startedAt, endedAt, status: "failed", params, nodeResults: current.nodeResults, definition: def })
          }
        })

        return { runId }
      },
    },
    rerun: {
      channel: "synapse:workflow:rerun", kind: "invoke",
      request: z.object({ previousRunId: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
      ]),
      handler: async (ctx, { previousRunId, params }: { previousRunId: string; params: Record<string, unknown> }) => {
        logger.info("workflow:rerun requested", { previousRunId })
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")

        let def: import("../../../src/types/workflow").WorkflowDefinition | undefined
        let workflowId: string | undefined
        let previousParams: Record<string, unknown> | undefined

        const memoryStatus = runStatuses.get(previousRunId)
        if (memoryStatus?.definition) {
          def = memoryStatus.definition
          workflowId = memoryStatus.workflowId
          previousParams = memoryStatus.params
        } else {
          const svc = ctx.resolve<WorkflowService>("core.workflow")
          const allWorkflows = await svc.list()
          for (const wf of allWorkflows) {
            const snapshot = await snapshots.get(previousRunId, wf.id)
            if (snapshot?.definition) {
              def = snapshot.definition
              workflowId = snapshot.workflowId
              previousParams = snapshot.params
              break
            }
          }
        }

        if (!def || !workflowId) {
          logger.error("workflow:rerun — cannot find definition for previous run", { previousRunId })
          return { errors: [{ type: "invalid_config", message: "无法找到上次运行使用的工作流定义" }] }
        }

        // Use previous run's params as fallback when caller passes empty params
        const callerHasParams = Object.keys(params).length > 0
        const effectiveParams = callerHasParams ? params : (previousParams ?? {})
        if (!callerHasParams && previousParams) {
          logger.info("workflow:rerun using previous run params", { previousRunId, paramKeys: Object.keys(previousParams) })
        }

        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshotSvc = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")

        const validation = validateWorkflow(def)
        if (!validation.valid) return { errors: validation.errors }

        for (const [existingRunId, status] of runStatuses) {
          if (status.workflowId === workflowId && status.status === "running") {
            abortMap.get(existingRunId)?.abort()
          }
        }

        const ac = new AbortController()
        const runId = randomUUID()
        const startedAt = Date.now()
        abortMap.set(runId, ac)
        runStatuses.set(runId, { runId, workflowId, status: "running", nodeResults: {}, startedAt, params: effectiveParams, definition: def })

        const appConfig = await configStore.load()
        const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
        const projectId = activeRepo?.uuid ?? ""

        engine.run(def, effectiveParams, runId, (event) => {
          const current = runStatuses.get(runId) ?? { runId, workflowId: workflowId!, status: "running" as const, nodeResults: {}, startedAt, definition: def }
          const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
          if (event.type === "node:started") {
            nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
          } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
            nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
          }
          runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })
          eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() }, { backpressure: "block" })
          if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
            abortMap.delete(runId)
            const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
            const endedAt = Date.now()
            const nodeResults = event.result?.nodeResults ?? nextNodeResults
            const durationMs = event.result?.durationMs ?? endedAt - startedAt
            runStatuses.set(runId, { ...current, runId, workflowId: workflowId!, status, nodeResults, startedAt, endedAt, durationMs, definition: def, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
            void snapshotSvc.save({ runId, workflowId: workflowId!, version: def!.version, startedAt, endedAt, status, params: effectiveParams, nodeResults, definition: def })
            pruneTerminalStatuses(runStatuses, workflowId!)
          }
        }, ac.signal, projectId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error("workflow engine rejected (rerun)", { workflowId, runId, error: errorMsg })
          abortMap.delete(runId)
          const current = runStatuses.get(runId)
          if (current && current.status === "running") {
            const endedAt = Date.now()
            runStatuses.set(runId, { runId, workflowId: workflowId!, status: "failed", nodeResults: current.nodeResults, startedAt, endedAt, durationMs: endedAt - startedAt, error: `引擎异常：${errorMsg}`, definition: def })
            eventBus.emit({ domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, error: `引擎异常：${errorMsg}`, result: { status: "failed", nodeResults: current.nodeResults, durationMs: endedAt - startedAt } }, timestamp: new Date().toISOString() }, { backpressure: "block" })
            void snapshotSvc.save({ runId, workflowId: workflowId!, version: def!.version, startedAt, endedAt, status: "failed", params: effectiveParams, nodeResults: current.nodeResults, definition: def })
          }
        })

        return { runId }
      },
    },
    openRunner: {
      channel: "synapse:workflow:open-runner", kind: "invoke",
      request: z.object({ workflowId: z.string(), runId: z.string() }),
      response: z.void(),
      handler: (ctx, { workflowId, runId }: { workflowId: string; runId: string }) => {
        logger.info("workflow:openRunner", { workflowId, runId })
        const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").openRunner(workflowId, runId, baseUrl)
      },
    },
    cancel: {
      channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: z.string() }), response: z.void(),
      handler: (ctx, { runId }: { runId: string }) => {
        logger.info("workflow:cancel requested", { runId })
        ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts").get(runId)?.abort()
        logger.info("workflow:cancel signal sent", { runId })
      },
    },
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: z.string() }), response: z.array(z.unknown()),
      handler: async (ctx, { workflowId }: { workflowId: string }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId),
    },
    runSnapshot: {
      channel: "synapse:workflow:run-snapshot", kind: "invoke", request: z.object({ runId: z.string(), workflowId: z.string() }), response: z.unknown().nullable(),
      handler: async (ctx, { runId, workflowId }: { runId: string; workflowId: string }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").get(runId, workflowId),
    },
    runStatus: {
      channel: "synapse:workflow:run-status", kind: "invoke", request: z.object({ runId: z.string() }), response: z.unknown().nullable(),
      handler: async (ctx, { runId }: { runId: string }) => {
        const live = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses").get(runId)
        if (live) return live
        // Fallback: terminal runs pruned from the in-memory map (MAX_TERMINAL_STATUSES_PER_WORKFLOW = 5)
        // are still on disk (up to MAX = 20 snapshots per workflow). Without this, opening an
        // older run from the history dialog would render an empty runner (no definition,
        // no node results, stuck at "running"). Hydrate from the snapshot store instead.
        const svc = ctx.resolve<WorkflowService>("core.workflow")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const metas = await svc.list()
        for (const meta of metas) {
          const snap = await snapshots.get(runId, meta.id)
          if (!snap) continue
          // When the run failed, extract a workflow-level error from the first
          // failed node's result.  The original event-level error was not
          // persisted to the snapshot (WorkflowRunSnapshot has no error field),
          // so we reconstruct it from the per-node errors that ARE stored.
          let error: string | undefined
          if (snap.status === "failed") {
            const failedNode = Object.values(snap.nodeResults).find((nr) => nr.status === "failed" && nr.error)
            if (failedNode?.error) error = failedNode.error
          }

          const hydrated: WorkflowRunStatus = {
            runId: snap.runId,
            workflowId: snap.workflowId,
            status: snap.status,
            nodeResults: snap.nodeResults,
            startedAt: snap.startedAt,
            endedAt: snap.endedAt,
            durationMs: snap.endedAt ? snap.endedAt - snap.startedAt : undefined,
            params: snap.params,
            definition: snap.definition,
            ...(error ? { error } : {}),
          }
          logger.info("run-status hydrated from snapshot", {
            runId, workflowId: snap.workflowId, status: snap.status,
            nodeCount: Object.keys(snap.nodeResults).length,
            hasDefinition: !!snap.definition,
            ...(error ? { recoveredErrorFromNodeResults: true } : {}),
          })
          return hydrated
        }
        logger.warn("run-status not found in memory or snapshots", { runId })
        return null
      },
    },
    openEditor: {
      channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: z.string(), runId: z.string().optional() }), response: z.void(),
      handler: (ctx, { id, runId }: { id: string; runId?: string }) => {
        logger.info("workflow:openEditor", { workflowId: id, runId })
        const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").open(id, baseUrl, runId)
      },
    },
    editorState: {
      channel: "synapse:workflow:editor-state", kind: "invoke", request: z.void().optional(),
      response: z.object({ openEditors: z.array(z.string()) }),
      handler: (ctx) => ({ openEditors: ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").getOpenEditorIds() }),
    },
    checkCanSync: {
      channel: "synapse:workflow:check-can-sync", kind: "invoke", request: z.void().optional(),
      response: z.object({ canSync: z.boolean(), blockers: z.array(z.string()) }),
      handler: (ctx) => ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").checkCanSync(),
    },
  },
  events: {
    event: {
      kind: "event", channel: "synapse:workflow:event",
      payload: z.object({ domain: z.literal("workflow"), type: z.string(), payload: z.unknown(), timestamp: z.string() }),
    },
  },
}
