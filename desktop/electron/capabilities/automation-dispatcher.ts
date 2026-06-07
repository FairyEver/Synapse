import { zodToJsonSchema } from "zod-to-json-schema"

import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { AutomationService } from "../services/automation"
import type { AutomationTriggerRegistry } from "../services/automation/trigger-registry"
import type { AutomationItem } from "../services/automation/types"
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

export type AutomationCapabilityDispatcherDeps = {
  readonly service: AutomationServicePort
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
  readonly actor: { kind: "user"; id: string }
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
    actor: { kind: "user", id: `automation-dispatch:${source}` },
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
