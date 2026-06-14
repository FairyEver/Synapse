import { zodToJsonSchema } from "zod-to-json-schema"
import type { DashboardWebhookDto } from "@synapse/shared" with { "resolution-mode": "import" }

import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type { AutomationService } from "../services/automation"
import type { AutomationTriggerRegistry } from "../services/automation/trigger-registry"
import { sanitizeError } from "../services/error-sanitize"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationRun,
  AutomationUpdateInput,
} from "../services/automation/types"
import type { ActionRunMetrics } from "../../action-packages/types"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type AutomationServicePort = Pick<
  AutomationService,
  | "automationList"
  | "automationGet"
  | "automationCreate"
  | "automationUpdate"
  | "automationDelete"
  | "automationEnable"
  | "automationDisable"
  | "runAutomationNow"
  | "stopRun"
  | "automationRunList"
  | "automationRuntimeInspect"
>

type AutomationAccountServicePort = {
  readonly listWebhooks: () => Promise<DashboardWebhookDto[]>
}

export type AutomationCapabilityDispatcherDeps = {
  readonly service: AutomationServicePort
  readonly accountService: AutomationAccountServicePort
  readonly triggers: AutomationTriggerRegistry
  readonly actions: MainActionRegistry
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}

type AutomationItemListParams = {
  readonly enabled?: boolean
  readonly limit?: number
  readonly scope?: { readonly type: "global" } | { readonly type: "project"; readonly projectId?: string }
}

type AutomationMutationSecurity = {
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const MUTATING_AUTOMATION_ACTIONS = new Set([
  "automation.item.create",
  "automation.item.update",
  "automation.item.delete",
  "automation.item.enable",
  "automation.item.disable",
  "automation.run.execute",
  "automation.run.disable",
])

export function createAutomationCapabilityDispatcher(deps: AutomationCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const security = automationMutationSecurity(action, params, context)
      if (security) await authorizeAutomationMutation(deps, security)

      try {
        let result: DispatchResult
        switch (action) {
          case "automation.trigger_type.list": {
            const descriptors = deps.triggers.list().map((definition) => ({
              type: definition.manifest.id,
              title: definition.manifest.title,
              kind: definition.manifest.kind,
              defaultConfig: definition.manifest.defaultConfig,
              configSchema: zodToJsonSchema(
                definition.manifest.configSchema as unknown as Parameters<typeof zodToJsonSchema>[0],
              ),
              ...(definition.manifest.variables ? { variables: definition.manifest.variables } : {}),
            }))
            result = { ok: true, data: descriptors, total: descriptors.length }
            break
          }

          case "automation.executor_type.list": {
            const descriptors = deps.actions.list().map((definition) => ({
              type: definition.manifest.id,
              title: definition.manifest.title,
              permissions: [...definition.manifest.permissions],
              defaultConfig: definition.manifest.defaultConfig,
              configFields: definition.manifest.configFields,
            }))
            result = { ok: true, data: descriptors, total: descriptors.length }
            break
          }

          case "automation.item.list": {
            const input = parseListParams(params)
            const items = await deps.service.automationList()
            const filtered = items
              .filter((item) => input.enabled === undefined || item.enabled === input.enabled)
              .filter((item) => matchesScope(item, input.scope))
              .slice(0, input.limit ?? items.length)
              .map((item) => toPublicAutomationItemSummary(item, deps.triggers, deps.actions))
            result = { ok: true, data: filtered, total: filtered.length }
            break
          }

          case "automation.item.get": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationGet(automationId)
            result = { ok: true, data: item ? toPublicAutomationItemSummary(item, deps.triggers, deps.actions) : null }
            break
          }

          case "automation.item.create": {
            const input = parseCreateParams(params, deps.triggers, deps.actions)
            const item = await deps.service.automationCreate(input)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "automation.item.update": {
            const input = parseUpdateParams(params, deps.triggers, deps.actions)
            const item = await deps.service.automationUpdate(input.automationId, input.patch)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "automation.item.delete": {
            const { automationId } = parseAutomationIdParams(params)
            result = { ok: true, data: await deps.service.automationDelete(automationId) }
            break
          }

          case "automation.item.enable": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationEnable(automationId)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "automation.item.disable": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationDisable(automationId)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "automation.run.execute": {
            const { automationId } = parseAutomationIdParams(params)
            const run = await deps.service.runAutomationNow(automationId)
            result = { ok: true, data: run ? toPublicAutomationRunSummary(run) : null }
            break
          }

          case "automation.run.disable": {
            const { runId } = parseRunIdParams(params)
            result = { ok: true, data: await deps.service.stopRun(runId) }
            break
          }

          case "automation.run.list": {
            const input = parseRunListParams(params)
            const item = await deps.service.automationGet(input.automationId)
            if (!item) throw new Error(`Automation "${input.automationId}" was not found`)
            const runs = await deps.service.automationRunList(input.automationId, { limit: input.limit })
            result = { ok: true, data: runs.map(toPublicAutomationRunSummary), total: runs.length }
            break
          }

          case "automation.runtime.inspect": {
            const input = parseRuntimeInspectParams(params)
            result = { ok: true, data: await buildRuntimeInspect(deps, input.automationId) }
            break
          }

          case "automation.webhook.list": {
            const webhooks = await deps.accountService.listWebhooks()
            result = { ok: true, data: webhooks.map(toPublicAutomationWebhookSummary), total: webhooks.length }
            break
          }

          default:
            throw new Error(`Unknown automation action: ${action}`)
        }

        if (security) {
          deps.auditSink?.record({
            action: "automation.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "allowed",
            metadata: security.metadata,
          })
        }
        return result
      } catch (error) {
        if (security) {
          deps.auditSink?.record({
            action: "automation.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "failed",
            metadata: {
              ...security.metadata,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
        }
        throw error
      }
    },
  }
}

export function toPublicAutomationRunSummary(run: AutomationRun) {
  const metrics = sanitizeAutomationRunMetrics(run.result?.metrics)

  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    triggeredBy: run.triggeredBy,
    triggerType: run.triggerType,
    executorType: run.executorType,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.error === undefined ? {} : { error: sanitizeError(run.error) }),
    ...(run.result?.summary === undefined ? {} : { summary: sanitizeError(run.result.summary) }),
    ...(metrics === undefined ? {} : { metrics }),
  }
}

function sanitizeAutomationRunMetrics(metrics: ActionRunMetrics | undefined): ActionRunMetrics | undefined {
  if (!metrics) return undefined

  const safeMetrics: ActionRunMetrics = {
    ...(typeof metrics.durationMs === "number" ? { durationMs: metrics.durationMs } : {}),
    ...(typeof metrics.exitCode === "number" || metrics.exitCode === null ? { exitCode: metrics.exitCode } : {}),
    ...(typeof metrics.httpStatus === "number" ? { httpStatus: metrics.httpStatus } : {}),
  }

  return Object.keys(safeMetrics).length > 0 ? safeMetrics : undefined
}

function toPublicAutomationWebhookSummary(webhook: DashboardWebhookDto) {
  return {
    publicId: webhook.publicId,
    name: webhook.name,
    enabled: webhook.enabled,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
    ...(webhook.lastDeliveryAt === undefined ? {} : { lastDeliveryAt: webhook.lastDeliveryAt }),
    ...(webhook.lastDeliveryStatus === undefined ? {} : { lastDeliveryStatus: webhook.lastDeliveryStatus }),
  }
}

export function toPublicAutomationItemSummary(
  item: AutomationItem,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
) {
  const validation = toPublicValidation(item.validation)
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled,
    scope: item.scope,
    cwd: item.cwd,
    trigger: triggerSummary(item, triggers),
    executor: executorSummary(item, actions),
    policy: item.policy,
    nextRunAt: item.nextRunAt,
    lastRunAt: item.lastRunAt,
    lastStatus: item.lastStatus,
    activeRun: item.activeRun,
    ...(validation ? { validation } : {}),
    runCount: item.runCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function triggerSummary(item: AutomationItem, triggers: AutomationTriggerRegistry) {
  try {
    const definition = triggers.get(item.trigger.type)
    return {
      type: item.trigger.type,
      kind: definition.manifest.kind,
      summary: definition.summarize(definition.manifest.configSchema.parse(item.trigger.config)),
    }
  } catch {
    return { type: item.trigger.type }
  }
}

function executorSummary(item: AutomationItem, actions: MainActionRegistry) {
  try {
    const definition = actions.get(item.executor.type)
    return { type: item.executor.type, title: definition.manifest.title }
  } catch {
    return { type: item.executor.type }
  }
}

function toPublicValidation(validation: AutomationItem["validation"]) {
  if (validation?.status !== "needs_update") return undefined
  return {
    status: "needs_update" as const,
    issues: validation.issues.map((issue) => ({
      field: issue.field,
      message: issue.message,
    })),
  }
}

function parseListParams(params: Record<string, unknown>): AutomationItemListParams {
  const enabled = params.enabled
  const limit = params.limit
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error("Missing or invalid 'enabled': expected boolean")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return {
    enabled: enabled as boolean | undefined,
    limit: limit as number | undefined,
    scope: parseOptionalScope(params.scope),
  }
}

function parseOptionalScope(value: unknown): AutomationItemListParams["scope"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Missing or invalid 'scope': expected object")
  if (value.type === "global") return { type: "global" }
  if (value.type === "project") {
    const projectId = value.projectId
    if (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) {
      throw new Error("Missing or invalid 'scope.projectId': expected non-empty string")
    }
    return { type: "project", projectId: projectId as string | undefined }
  }
  throw new Error("Missing or invalid 'scope.type': expected global or project")
}

function matchesScope(item: AutomationItem, scope: AutomationItemListParams["scope"]): boolean {
  if (!scope) return true
  if (scope.type !== item.scope.type) return false
  if (scope.type === "project" && scope.projectId) {
    return item.scope.type === "project" && item.scope.projectId === scope.projectId
  }
  return true
}

function parseAutomationIdParams(params: Record<string, unknown>): { automationId: string } {
  const automationId = params.automationId
  if (typeof automationId !== "string" || !automationId.trim()) {
    throw new Error("Missing or invalid 'automationId': expected non-empty string")
  }
  return { automationId }
}

function parseCreateParams(
  params: Record<string, unknown>,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
): AutomationCreateInput {
  const name = params.name
  const scope = params.scope
  const trigger = params.trigger
  const executor = params.executor
  if (typeof name !== "string" || !name.trim()) throw new Error("Missing or invalid 'name': expected non-empty string")
  if (!isRecord(scope)) throw new Error("Missing or invalid 'scope': expected object")
  if (!isRecord(trigger)) throw new Error("Missing or invalid 'trigger': expected object")
  if (!isRecord(executor)) throw new Error("Missing or invalid 'executor': expected object")
  const input: AutomationCreateInput = {
    name,
    scope: parseScope(scope),
    trigger: parseTriggerRef(trigger, triggers),
    executor: parseExecutorRef(executor, actions),
  }
  assignIfDefined(input, "description", optionalString(params.description, "description"))
  assignIfDefined(input, "enabled", optionalBoolean(params.enabled, "enabled"))
  assignIfDefined(input, "cwd", optionalString(params.cwd, "cwd"))
  assignIfDefined(input, "policy", parseOptionalPolicy(params.policy))
  return input
}

function parseUpdateParams(
  params: Record<string, unknown>,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
): { automationId: string; patch: AutomationUpdateInput } {
  const { automationId } = parseAutomationIdParams(params)
  const patchRecord = requireRecord(params.patch, "patch")
  const allowed = new Set(["name", "description", "enabled", "scope", "cwd", "trigger", "executor", "policy"])
  for (const key of Object.keys(patchRecord)) {
    if (!allowed.has(key)) throw new Error(`Forbidden automation update field: ${key}`)
  }

  const patch: AutomationUpdateInput = {}
  assignIfDefined(patch, "name", optionalString(patchRecord.name, "patch.name"))
  assignIfDefined(patch, "description", optionalString(patchRecord.description, "patch.description"))
  assignIfDefined(patch, "enabled", optionalBoolean(patchRecord.enabled, "patch.enabled"))
  assignIfDefined(
    patch,
    "scope",
    patchRecord.scope === undefined ? undefined : parseScope(requireRecord(patchRecord.scope, "patch.scope")),
  )
  assignIfDefined(patch, "cwd", optionalString(patchRecord.cwd, "patch.cwd"))
  assignIfDefined(
    patch,
    "trigger",
    patchRecord.trigger === undefined ? undefined : parseTriggerRef(requireRecord(patchRecord.trigger, "patch.trigger"), triggers),
  )
  assignIfDefined(
    patch,
    "executor",
    patchRecord.executor === undefined ? undefined : parseExecutorRef(requireRecord(patchRecord.executor, "patch.executor"), actions),
  )
  assignIfDefined(patch, "policy", parseOptionalPolicy(patchRecord.policy))
  if (Object.keys(patch).length === 0) {
    throw new Error("automation.item.update requires at least one field to update")
  }
  return { automationId, patch }
}

function parseTriggerRef(value: Record<string, unknown>, triggers: AutomationTriggerRegistry) {
  const type = requireRecordString(value, "type", "trigger.type")
  const config = requireRecord(value.config, "trigger.config")
  return {
    type,
    config: triggers.parseConfig(type, config),
  }
}

function parseExecutorRef(value: Record<string, unknown>, actions: MainActionRegistry) {
  const type = requireRecordString(value, "type", "executor.type")
  const config = requireRecord(value.config, "executor.config")
  return {
    type,
    config: actions.parseConfig(type, config),
  }
}

function parseScope(value: Record<string, unknown>) {
  if (value.type === "global") return { type: "global" as const }
  if (value.type === "project") {
    const projectId = value.projectId
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Missing or invalid 'scope.projectId': expected non-empty string")
    }
    return { type: "project" as const, projectId }
  }
  throw new Error("Missing or invalid 'scope.type': expected global or project")
}

function parseOptionalPolicy(value: unknown): { missedRunPolicy?: "skip" | "run_once"; overlapPolicy?: "skip" } | undefined {
  if (value === undefined) return undefined
  const record = requireRecord(value, "policy")
  const missedRunPolicy = record.missedRunPolicy
  const overlapPolicy = record.overlapPolicy
  if (missedRunPolicy !== undefined && missedRunPolicy !== "skip" && missedRunPolicy !== "run_once") {
    throw new Error("Missing or invalid 'policy.missedRunPolicy': expected skip or run_once")
  }
  if (overlapPolicy !== undefined && overlapPolicy !== "skip") {
    throw new Error("Missing or invalid 'policy.overlapPolicy': expected skip")
  }
  const policy: { missedRunPolicy?: "skip" | "run_once"; overlapPolicy?: "skip" } = {}
  if (missedRunPolicy !== undefined) policy.missedRunPolicy = missedRunPolicy
  if (overlapPolicy !== undefined) policy.overlapPolicy = overlapPolicy
  return policy
}

function parseRunIdParams(params: Record<string, unknown>): { runId: string } {
  return { runId: requireString(params, "runId") }
}

function parseRunListParams(params: Record<string, unknown>): { automationId: string; limit: number } {
  const { automationId } = parseAutomationIdParams(params)
  const rawLimit = params.limit
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || Number(rawLimit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return { automationId, limit: rawLimit === undefined ? 20 : Math.min(rawLimit as number, 100) }
}

function parseRuntimeInspectParams(params: Record<string, unknown>): { automationId?: string } {
  if (params.automationId === undefined) return {}
  return parseAutomationIdParams(params)
}

async function buildRuntimeInspect(deps: AutomationCapabilityDispatcherDeps, automationId?: string) {
  const inspect = deps.service.automationRuntimeInspect()
  const runningItemIds = [...inspect.runningItemIds]
  const scheduledItemIds = [...inspect.timers]
  const items = automationId
    ? [await deps.service.automationGet(automationId)]
    : await deps.service.automationList()
  if (automationId && !items[0]) throw new Error(`Automation "${automationId}" was not found`)
  return {
    runningItemIds,
    scheduledItemIds,
    items: items
      .filter((item): item is AutomationItem => item !== null)
      .filter((item) => Boolean(automationId) || runningItemIds.includes(item.id) || scheduledItemIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        enabled: item.enabled,
        running: runningItemIds.includes(item.id),
        scheduled: scheduledItemIds.includes(item.id),
        activeRunId: item.activeRun?.id,
        nextRunAt: item.nextRunAt,
        lastRunAt: item.lastRunAt,
        lastStatus: item.lastStatus,
      })),
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  return requireRecordString(params, key, key)
}

function requireRecordString(params: Record<string, unknown>, key: string, label: string): string {
  const value = params[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid '${label}': expected non-empty string`)
  }
  return value
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Missing or invalid '${key}': expected object`)
  return value
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`Missing or invalid '${key}': expected string`)
  return value
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`Missing or invalid '${key}': expected boolean`)
  return value
}

function assignIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

function automationMutationSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): AutomationMutationSecurity | null {
  if (!MUTATING_AUTOMATION_ACTIONS.has(action)) return null
  const source = context.source ?? "api"
  const automationId = typeof params.automationId === "string" && params.automationId.trim()
    ? params.automationId.trim()
    : action
  const runId = typeof params.runId === "string" && params.runId.trim()
    ? params.runId.trim()
    : undefined
  return {
    actor: context.actor ?? { kind: "user", id: `automation-dispatch:${source}` },
    resource: `automation:${runId ?? automationId}`,
    metadata: {
      source,
      automationAction: action,
      ...(automationId !== action ? { automationId } : {}),
      ...(runId ? { runId } : {}),
      ...(isRecord(params.patch) ? { patchKeys: Object.keys(params.patch) } : {}),
      ...(isRecord(params.trigger) && typeof params.trigger.type === "string" ? { triggerType: params.trigger.type } : {}),
      ...(isRecord(params.executor) && typeof params.executor.type === "string" ? { executorType: params.executor.type } : {}),
    },
  }
}

async function authorizeAutomationMutation(
  deps: Pick<AutomationCapabilityDispatcherDeps, "permissionGuard" | "auditSink">,
  security: AutomationMutationSecurity,
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
    action: "automation.mutate",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "automation.mutate",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
