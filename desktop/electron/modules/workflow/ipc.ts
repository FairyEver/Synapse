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

const logger = createMainLogger("workflow.ipc")

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
        const validation = validateWorkflow(def as never)
        if (!validation.valid) {
          logger.warn("workflow:save blocked by validation", { id: d.id, errorCount: validation.errors.length, errors: validation.errors })
          return { errors: validation.errors }
        }
        logger.info("workflow:save validation passed", { id: d.id })
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
      handler: (ctx, { runId }: { runId: string }) => ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses").get(runId) ?? null,
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
