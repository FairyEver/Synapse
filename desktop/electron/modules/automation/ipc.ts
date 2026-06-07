import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { createMainLogger } from "../../services/log-store"
import type { AutomationService } from "../../services/automation"
import { automationWindowService } from "../../services/automation-window-service"

const logger = createMainLogger("automation.ipc")

const automationScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("project"), projectId: z.string().min(1) }),
])

const automationTriggerSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const automationExecutorSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const automationStatusSchema = z.enum(["success", "failed", "timeout", "cancelled", "skipped"])
const automationRunStatusSchema = z.enum(["running", "success", "failed", "timeout", "cancelled", "skipped"])
const automationRunTriggerSchema = z.enum(["trigger", "manual", "missed_run"])
const automationChangedReasonSchema = z.enum([
  "created",
  "updated",
  "deleted",
  "enabled",
  "disabled",
  "scheduled",
  "run-started",
  "run-finished",
  "run-skipped",
  "run-stopped",
])

const activeRunSchema = z.object({
  status: z.literal("running"),
  id: z.string().min(1).optional(),
})

const automationValidationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("valid"),
    issues: z.tuple([]),
  }),
  z.object({
    status: z.literal("needs_update"),
    issues: z.array(z.object({
      field: z.string().min(1),
      message: z.string().min(1),
    })).min(1),
  }),
])

const actionRunResultSchema = z.object({
  status: z.enum(["success", "failed", "timeout", "cancelled"]),
  summary: z.string().optional(),
  logs: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  costUsd: z.number().optional(),
  costCny: z.number().optional(),
  costCurrency: z.literal("CNY").optional(),
  metrics: z.object({
    durationMs: z.number().optional(),
    exitCode: z.number().nullable().optional(),
    httpStatus: z.number().optional(),
  }).optional(),
})

const automationPolicySchema = z.object({
  missedRunPolicy: z.enum(["skip", "run_once"]),
  overlapPolicy: z.literal("skip"),
})

const automationItemSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  scope: automationScopeSchema,
  cwd: z.string().optional(),
  trigger: automationTriggerSchema,
  executor: automationExecutorSchema,
  policy: automationPolicySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastStatus: automationStatusSchema.optional(),
  activeRun: activeRunSchema.optional(),
  validation: automationValidationSchema.optional(),
  runCount: z.number(),
  configVersion: z.number(),
})

const automationRunSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  automationId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: automationRunStatusSchema,
  triggeredBy: automationRunTriggerSchema,
  triggerType: z.string(),
  executorType: z.string(),
  result: actionRunResultSchema.optional(),
  error: z.string().optional(),
})

const automationChangedEventPayloadSchema = z.object({
  automationId: z.string().optional(),
  runId: z.string().optional(),
  reason: automationChangedReasonSchema,
})

const automationChangedDomainEventSchema = z.object({
  domain: z.literal("automation"),
  type: z.literal("automation.itemChanged"),
  payload: automationChangedEventPayloadSchema,
  timestamp: z.string(),
})

const createAutomationInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  scope: automationScopeSchema,
  cwd: z.string().optional(),
  trigger: automationTriggerSchema,
  executor: automationExecutorSchema,
  policy: z.object({
    missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
    overlapPolicy: z.literal("skip").optional(),
  }).optional(),
})

const updateAutomationPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  scope: automationScopeSchema.optional(),
  cwd: z.string().optional(),
  trigger: automationTriggerSchema.optional(),
  executor: automationExecutorSchema.optional(),
  policy: z.object({
    missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
    overlapPolicy: z.literal("skip").optional(),
  }).optional(),
})

const automationIdRequestSchema = z.object({
  automationId: z.string().min(1),
})

const updateAutomationRequestSchema = z.object({
  id: z.string().min(1),
  patch: updateAutomationPatchSchema,
})

type AutomationIdRequest = z.infer<typeof automationIdRequestSchema>
type CreateAutomationInput = z.infer<typeof createAutomationInputSchema>
type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>
type SetAutomationEnabledRequest = AutomationIdRequest & { readonly enabled: boolean }
type StopRunRequest = { readonly runId: string }
type ListRunsRequest = AutomationIdRequest & { readonly limit?: number }

export const automationIpcModule: IpcModule = {
  id: "automation",
  methods: {
    openCreateEditorWindow: {
      channel: "synapse:automation:editor:open-create",
      kind: "invoke",
      request: z.void().optional(),
      response: z.void(),
      handler: async () => {
        await loggedAutomationIpc(
          "synapse:automation:editor:open-create",
          "automation.ipc.open-create-editor-window",
          {},
          () => automationWindowService.openCreate(),
        )
      },
    },
    openEditorWindow: {
      channel: "synapse:automation:editor:open-edit",
      kind: "invoke",
      request: automationIdRequestSchema,
      response: z.void(),
      handler: async (_ctx, request: AutomationIdRequest) => {
        await loggedAutomationIpc(
          "synapse:automation:editor:open-edit",
          "automation.ipc.open-editor-window",
          { automationId: request.automationId },
          () => automationWindowService.openEdit(request.automationId),
        )
      },
    },
    listItems: {
      channel: "synapse:automation:items:list",
      kind: "invoke",
      request: z.void().optional(),
      response: z.array(automationItemSchema),
      handler: async (ctx) => loggedAutomationIpc(
        "synapse:automation:items:list",
        "automation.ipc.list-items",
        {},
        () => ctx.resolve<AutomationService>("core.automation").automationList(),
      ),
    },
    getItem: {
      channel: "synapse:automation:items:get",
      kind: "invoke",
      request: automationIdRequestSchema,
      response: automationItemSchema.nullable(),
      handler: async (ctx, request: AutomationIdRequest) => loggedAutomationIpc(
        "synapse:automation:items:get",
        "automation.ipc.get-item",
        { automationId: request.automationId },
        () => ctx.resolve<AutomationService>("core.automation").automationGet(request.automationId),
      ),
    },
    createItem: {
      channel: "synapse:automation:items:create",
      kind: "invoke",
      request: createAutomationInputSchema,
      response: automationItemSchema,
      handler: async (ctx, request: CreateAutomationInput) => loggedAutomationIpc(
        "synapse:automation:items:create",
        "automation.ipc.create-item",
        {
          triggerType: request.trigger.type,
          executorType: request.executor.type,
          enabled: request.enabled,
          automationNameLength: request.name.length,
        },
        () => ctx.resolve<AutomationService>("core.automation").automationCreate(request),
      ),
    },
    updateItem: {
      channel: "synapse:automation:items:update",
      kind: "invoke",
      request: updateAutomationRequestSchema,
      response: automationItemSchema,
      handler: async (ctx, request: UpdateAutomationRequest) => loggedAutomationIpc(
        "synapse:automation:items:update",
        "automation.ipc.update-item",
        {
          automationId: request.id,
          patchKeys: Object.keys(request.patch),
        },
        () => ctx.resolve<AutomationService>("core.automation").automationUpdate(request.id, request.patch),
      ),
    },
    deleteItem: {
      channel: "synapse:automation:items:delete",
      kind: "invoke",
      request: automationIdRequestSchema,
      response: z.object({ deleted: z.boolean() }),
      handler: async (ctx, request: AutomationIdRequest) => loggedAutomationIpc(
        "synapse:automation:items:delete",
        "automation.ipc.delete-item",
        { automationId: request.automationId },
        () => ctx.resolve<AutomationService>("core.automation").automationDelete(request.automationId),
      ),
    },
    setItemEnabled: {
      channel: "synapse:automation:items:set-enabled",
      kind: "invoke",
      request: automationIdRequestSchema.extend({ enabled: z.boolean() }),
      response: automationItemSchema,
      handler: async (ctx, request: SetAutomationEnabledRequest) => loggedAutomationIpc(
        "synapse:automation:items:set-enabled",
        "automation.ipc.set-item-enabled",
        { automationId: request.automationId, enabled: request.enabled },
        () => request.enabled
          ? ctx.resolve<AutomationService>("core.automation").automationEnable(request.automationId)
          : ctx.resolve<AutomationService>("core.automation").automationDisable(request.automationId),
      ),
    },
    runItem: {
      channel: "synapse:automation:items:run",
      kind: "invoke",
      request: automationIdRequestSchema,
      response: automationRunSchema.nullable(),
      handler: async (ctx, request: AutomationIdRequest) => loggedAutomationIpc(
        "synapse:automation:items:run",
        "automation.ipc.run-item",
        { automationId: request.automationId },
        () => ctx.resolve<AutomationService>("core.automation").runAutomationNow(request.automationId),
      ),
    },
    stopRun: {
      channel: "synapse:automation:runs:stop",
      kind: "invoke",
      request: z.object({ runId: z.string().min(1) }),
      response: z.object({ stopped: z.boolean(), alreadyFinished: z.boolean().optional() }),
      handler: async (ctx, request: StopRunRequest) => loggedAutomationIpc(
        "synapse:automation:runs:stop",
        "automation.ipc.stop-run",
        { runId: request.runId },
        () => ctx.resolve<AutomationService>("core.automation").stopRun(request.runId),
      ),
    },
    listRuns: {
      channel: "synapse:automation:runs:list",
      kind: "invoke",
      request: automationIdRequestSchema.extend({
        limit: z.number().int().positive().max(100).optional(),
      }),
      response: z.array(automationRunSchema),
      handler: async (ctx, request: ListRunsRequest) => loggedAutomationIpc(
        "synapse:automation:runs:list",
        "automation.ipc.list-runs",
        { automationId: request.automationId, limit: request.limit },
        () => ctx.resolve<AutomationService>("core.automation").automationRunList(request.automationId, { limit: request.limit }),
      ),
    },
  },
  events: {
    changed: {
      kind: "event",
      channel: "synapse:events:automation",
      payload: automationChangedDomainEventSchema,
    },
  },
}

function errorDiagnostic(rawError: unknown): Record<string, unknown> {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const errorLike = rawError as { readonly code?: unknown } | null
  const code = typeof errorLike?.code === "string" ? errorLike.code : undefined
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    ...(code ? { errorCode: code } : {}),
  }
}

async function loggedAutomationIpc<T>(
  channel: string,
  boundary: string,
  metadata: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  logger.info("Automation IPC request.", {
    boundary,
    channel,
    ...metadata,
  })
  try {
    const result = await run()
    logger.info("Automation IPC completed.", {
      boundary,
      channel,
      durationMs: Date.now() - startedAt,
      ...metadata,
    })
    return result
  } catch (rawError) {
    logger.warn("Automation IPC failed.", {
      boundary,
      channel,
      durationMs: Date.now() - startedAt,
      ...metadata,
      ...errorDiagnostic(rawError),
    })
    throw rawError
  }
}
