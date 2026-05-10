import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WorkflowService } from "../../services/workflow/workflow-service"
import type { WorkflowEngine } from "../../services/workflow/workflow-engine"
import type { RunSnapshotService } from "../../services/workflow/run-snapshot-service"
import type { WorkflowWindowManager } from "../../services/workflow/window-manager"
import type { EventBus } from "../../runtime/event-bus"
import { validateWorkflow } from "../../services/workflow/workflow-validator"

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
      handler: async (ctx) => ctx.resolve<WorkflowService>("core.workflow").list(),
    },
    get: {
      channel: "synapse:workflow:get", kind: "invoke", request: z.object({ id: z.string() }),
      response: workflowDefinitionSchema.nullable(),
      handler: async (ctx, { id }: { id: string }) => ctx.resolve<WorkflowService>("core.workflow").get(id),
    },
    save: {
      channel: "synapse:workflow:save", kind: "invoke", request: workflowDefinitionSchema,
      response: z.union([z.object({ versionHash: z.string() }), z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) })]),
      handler: async (ctx, def) => ctx.resolve<WorkflowService>("core.workflow").save(def as never),
    },
    delete: {
      channel: "synapse:workflow:delete", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
      handler: async (ctx, { id }: { id: string }) => ctx.resolve<WorkflowService>("core.workflow").delete(id),
    },
    validate: {
      channel: "synapse:workflow:validate", kind: "invoke", request: workflowDefinitionSchema, response: validationResultSchema,
      handler: async (_ctx, def) => validateWorkflow(def as never),
    },
    run: {
      channel: "synapse:workflow:run", kind: "invoke",
      request: z.object({ id: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.object({ runId: z.string() }),
      handler: async (ctx, { id, params }: { id: string; params: Record<string, unknown> }) => {
        const svc = ctx.resolve<WorkflowService>("core.workflow")
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")

        const def = await svc.get(id)
        if (!def) throw new Error(`Workflow ${id} not found`)

        const ac = new AbortController()
        const runId = randomUUID()
        abortMap.set(runId, ac)

        void engine.run(def, params, runId, (event) => {
          eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() })
          if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
            abortMap.delete(runId)
            const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
            const nodeResults = event.type === "workflow:completed" ? event.result.nodeResults : {}
            void snapshots.save({ runId, workflowId: id, version: def.version, startedAt: Date.now(), endedAt: Date.now(), status, params, nodeResults })
          }
        })

        return { runId }
      },
    },
    cancel: {
      channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: z.string() }), response: z.void(),
      handler: (ctx, { runId }: { runId: string }) => { ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts").get(runId)?.abort() },
    },
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: z.string() }), response: z.array(z.unknown()),
      handler: async (ctx, { workflowId }: { workflowId: string }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId),
    },
    runSnapshot: {
      channel: "synapse:workflow:run-snapshot", kind: "invoke", request: z.object({ runId: z.string(), workflowId: z.string() }), response: z.unknown().nullable(),
      handler: async (ctx, { runId, workflowId }: { runId: string; workflowId: string }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").get(runId, workflowId),
    },
    openEditor: {
      channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
      handler: (ctx, { id }: { id: string }) => {
        const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").open(id, baseUrl)
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
