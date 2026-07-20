import { zodToJsonSchema } from "zod-to-json-schema"
import type { DashboardWebhookDto } from "@synapse/shared" with { "resolution-mode": "import" }

import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import type { AutomationService } from "../services/automation"
import type { AutomationTriggerRegistry } from "../services/automation/trigger-registry"
import { errorLogMeta, sanitizeError } from "../services/error-sanitize"
import { createPlatformActionDefaultConfig } from "../../action-packages/builtin/shell-defaults"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationListOptions,
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

type AutomationSummaryLogger = {
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void
}

const noopSummaryLogger: AutomationSummaryLogger = {
  warn: () => undefined,
}

function automationSummaryLogger(deps: AutomationCapabilityDispatcherDeps): AutomationSummaryLogger {
  return deps.logger ?? noopSummaryLogger
}

export type AutomationCapabilityDispatcherDeps = {
  readonly service: AutomationServicePort
  readonly accountService: AutomationAccountServicePort
  readonly triggers: AutomationTriggerRegistry
  readonly actions: MainActionRegistry
  readonly platform?: string
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: AutomationSummaryLogger
}

type AutomationItemListParams = AutomationListOptions

type AutomationDispatchSecurity = {
  readonly action: Extract<PermissionAction, "automation.read" | "automation.mutate">
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const READING_AUTOMATION_ACTIONS = new Set([
  "app.automation.trigger_type.list",
  "app.automation.executor_type.list",
  "app.automation.item.list",
  "app.automation.item.get",
  "app.automation.run.list",
  "app.automation.runtime.inspect",
  "app.automation.webhook.list",
])
const MUTATING_AUTOMATION_ACTIONS = new Set([
  "app.automation.item.create",
  "app.automation.item.update",
  "app.automation.item.delete",
  "app.automation.item.enable",
  "app.automation.item.disable",
  "app.automation.run.execute",
  "app.automation.run.disable",
])
const SAFE_AUDIT_IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/

export function createAutomationCapabilityDispatcher(deps: AutomationCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const security = automationDispatchSecurity(action, params, context)
      if (security) await authorizeAutomationDispatch(deps, security)

      try {
        let result: DispatchResult
        switch (action) {
          case "app.automation.trigger_type.list": {
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

          case "app.automation.executor_type.list": {
            const platform = deps.platform ?? process.platform
            const descriptors = deps.actions.list().map((definition) => ({
              type: definition.manifest.id,
              title: definition.manifest.title,
              permissions: [...definition.manifest.permissions],
              defaultConfig: createPlatformActionDefaultConfig(
                definition.manifest.id,
                definition.manifest.defaultConfig,
                platform,
              ),
              configFields: definition.manifest.configFields,
            }))
            result = { ok: true, data: descriptors, total: descriptors.length }
            break
          }

          case "app.automation.item.list": {
            const input = parseListParams(params)
            const items = await deps.service.automationList(input)
            const summaries = items.map((item) => toPublicAutomationItemSummary(item, deps.triggers, deps.actions, automationSummaryLogger(deps)))
            result = { ok: true, data: summaries, total: summaries.length }
            break
          }

          case "app.automation.item.get": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationGet(automationId)
            result = { ok: true, data: item ? toPublicAutomationItemSummary(item, deps.triggers, deps.actions, automationSummaryLogger(deps)) : null }
            break
          }

          case "app.automation.item.create": {
            const input = parseCreateParams(params, deps.triggers, deps.actions, deps.platform ?? process.platform)
            const item = await deps.service.automationCreate(input)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "app.automation.item.update": {
            const input = parseUpdateParams(params, deps.triggers, deps.actions, deps.platform ?? process.platform)
            const item = await deps.service.automationUpdate(input.automationId, input.patch)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "app.automation.item.delete": {
            const { automationId } = parseAutomationIdParams(params)
            result = { ok: true, data: await deps.service.automationDelete(automationId) }
            break
          }

          case "app.automation.item.enable": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationEnable(automationId)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "app.automation.item.disable": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationDisable(automationId)
            result = { ok: true, data: toPublicAutomationItemSummary(item, deps.triggers, deps.actions) }
            break
          }

          case "app.automation.run.execute": {
            const { automationId } = parseAutomationIdParams(params)
            const run = await deps.service.runAutomationNow(automationId)
            if (!run) throw new Error(`Automation "${automationId}" was not found or did not start`)
            result = { ok: true, data: toPublicAutomationRunSummary(run) }
            break
          }

          case "app.automation.run.disable": {
            const { runId } = parseRunIdParams(params)
            const stopResult = await deps.service.stopRun(runId)
            if (!stopResult.stopped && !stopResult.alreadyFinished && !stopResult.stopRequested) {
              throw new Error(`Automation run "${runId}" was not active or was not found`)
            }
            result = { ok: true, data: stopResult }
            break
          }

          case "app.automation.run.list": {
            const input = parseRunListParams(params)
            const item = await deps.service.automationGet(input.automationId)
            if (!item) throw new Error(`Automation "${input.automationId}" was not found`)
            const runs = await deps.service.automationRunList(input.automationId, { limit: input.limit })
            result = { ok: true, data: runs.map(toPublicAutomationRunSummary), total: runs.length }
            break
          }

          case "app.automation.runtime.inspect": {
            const input = parseRuntimeInspectParams(params)
            result = { ok: true, data: await buildRuntimeInspect(deps, input.automationId) }
            break
          }

          case "app.automation.webhook.list": {
            const webhooks = await deps.accountService.listWebhooks()
            result = { ok: true, data: webhooks.map(toPublicAutomationWebhookSummary), total: webhooks.length }
            break
          }

          default:
            throw new Error(`Unknown automation action: ${action}`)
        }

        if (security) {
          deps.auditSink?.record({
            action: security.action,
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
            action: security.action,
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
  summaryLogger: AutomationSummaryLogger = noopSummaryLogger,
) {
  const validation = toPublicValidation(item.validation)
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled,
    scope: item.scope,
    cwd: item.cwd,
    trigger: triggerSummary(item, triggers, summaryLogger),
    executor: executorSummary(item, actions, summaryLogger),
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

function triggerSummary(item: AutomationItem, triggers: AutomationTriggerRegistry, summaryLogger: AutomationSummaryLogger) {
  try {
    const definition = triggers.get(item.trigger.type)
    return {
      type: item.trigger.type,
      kind: definition.manifest.kind,
      summary: definition.summarize(definition.manifest.configSchema.parse(item.trigger.config)),
    }
  } catch (error) {
    summaryLogger.warn("Automation trigger summary fallback.", {
      triggerType: item.trigger.type,
      boundary: "automation-dispatcher.triggerSummary",
      ...errorLogMeta(error, { includeMessage: true, messageLimit: 240 }),
    })
    return { type: item.trigger.type }
  }
}

function executorSummary(item: AutomationItem, actions: MainActionRegistry, summaryLogger: AutomationSummaryLogger) {
  try {
    const definition = actions.get(item.executor.type)
    return { type: item.executor.type, title: definition.manifest.title }
  } catch (error) {
    summaryLogger.warn("Automation executor summary fallback.", {
      executorType: item.executor.type,
      boundary: "automation-dispatcher.executorSummary",
      ...errorLogMeta(error, { includeMessage: true, messageLimit: 240 }),
    })
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
  platform: string,
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
    executor: parseExecutorRef(executor, actions, platform),
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
  platform: string,
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
    patchRecord.executor === undefined ? undefined : parseExecutorRef(requireRecord(patchRecord.executor, "patch.executor"), actions, platform),
  )
  assignIfDefined(patch, "policy", parseOptionalPolicy(patchRecord.policy))
  if (Object.keys(patch).length === 0) {
    throw new Error("app.automation.item.update requires at least one field to update")
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

function parseExecutorRef(value: Record<string, unknown>, actions: MainActionRegistry, platform: string) {
  const type = requireRecordString(value, "type", "executor.type")
  const config = requireRecord(value.config, "executor.config")
  const action = actions.get(type)
  const defaultConfig = createPlatformActionDefaultConfig(type, action.manifest.defaultConfig, platform)
  return {
    type,
    config: action.manifest.configSchema.parse({ ...defaultConfig, ...config }),
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
  const runtimeItemIds = [...new Set([...runningItemIds, ...scheduledItemIds])]
  const items = automationId
    ? [await deps.service.automationGet(automationId)]
    : await Promise.all(runtimeItemIds.map((id) => deps.service.automationGet(id)))
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

function automationDispatchSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): AutomationDispatchSecurity | null {
  const permissionAction = MUTATING_AUTOMATION_ACTIONS.has(action)
    ? "automation.mutate"
    : READING_AUTOMATION_ACTIONS.has(action)
      ? "automation.read"
      : null
  if (!permissionAction) return null
  const source = context.source ?? "api"
  const automationId = safeAuditIdentifier(params.automationId)
  const runId = safeAuditIdentifier(params.runId)
  return {
    action: permissionAction,
    actor: context.actor ?? { kind: "user", id: `automation-dispatch:${source}` },
    resource: `automation:${runId ?? automationId ?? action}`,
    metadata: {
      source,
      automationAction: action,
      ...(automationId ? { automationId } : {}),
      ...(runId ? { runId } : {}),
      ...(isRecord(params.patch) ? { patchKeys: Object.keys(params.patch) } : {}),
      ...(isRecord(params.trigger) && typeof params.trigger.type === "string" ? { triggerType: params.trigger.type } : {}),
      ...(isRecord(params.executor) && typeof params.executor.type === "string" ? { executorType: params.executor.type } : {}),
    },
  }
}

function safeAuditIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return SAFE_AUDIT_IDENTIFIER_PATTERN.test(trimmed) ? trimmed : undefined
}

async function authorizeAutomationDispatch(
  deps: Pick<AutomationCapabilityDispatcherDeps, "permissionGuard" | "auditSink">,
  security: AutomationDispatchSecurity,
): Promise<void> {
  let permission: Awaited<ReturnType<NonNullable<AutomationCapabilityDispatcherDeps["permissionGuard"]>["check"]>> | undefined
  try {
    permission = await deps.permissionGuard?.check({
      action: security.action,
      actor: security.actor,
      resource: security.resource,
      context: security.metadata,
    })
  } catch (error) {
    deps.auditSink?.record({
      action: security.action,
      actor: security.actor,
      resource: security.resource,
      outcome: "failed",
      metadata: {
        ...security.metadata,
        reason: "permission-check-error",
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: security.action,
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
