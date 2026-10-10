import type { PortalRequest } from '../session/types.js'
import { evaluatePermissionExpression, type ContextRule, type PermissionPolicy, type PermissionPolicyEntry } from './policy.js'

export class PermissionDeniedError extends Error {
  readonly code = 403
  readonly capabilityId: string
  readonly policyRevision: string | null
  readonly failedRule: string
  constructor (capabilityId: string, failedRule: string, policyRevision: string | null) {
    super(`PH capability ${capabilityId} 被权限闸门拒绝：${failedRule}`)
    this.name = 'PermissionDeniedError'; this.capabilityId = capabilityId; this.failedRule = failedRule; this.policyRevision = policyRevision
  }
}

export type PermissionGateOptions = {
  policy: PermissionPolicy
  request: PortalRequest
  permissionCodes?: () => Promise<ReadonlySet<string>>
  context?: () => Promise<Record<string, unknown>>
  evaluators?: Record<string, (rule: ContextRule, context: Record<string, unknown>) => boolean | Promise<boolean>>
  onDenied?: (event: { capabilityId: string; policyRevision: string | null; failedRule: string }) => void
}

function extractCodes (payload: unknown): Set<string> {
  const output = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { output.add(value); return }
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['permission', 'permissions', 'permissionCode', 'code']) if (key in record) visit(record[key])
      for (const key of ['list', 'data', 'rows', 'menus']) if (key in record) visit(record[key])
    }
  }
  visit(payload); return output
}

export function createPermissionGate (options: PermissionGateOptions) {
  const permissionCodes = options.permissionCodes ?? (async () => extractCodes(await options.request({ url: '/admin-api/sys/menu/permissionsNotBySystem', method: 'get' })))
  const context = options.context ?? (async () => ({}))
  const builtIns: Record<string, (rule: ContextRule, context: Record<string, unknown>) => boolean> = {
    tenant: (rule, values) => rule.args?.id === undefined || String(values.tenantId) === String(rule.args.id),
    system: (rule, values) => rule.args?.id === undefined || (Array.isArray(values.systemIds) ? values.systemIds.some(id => String(id) === String(rule.args?.id)) : String(values.systemId) === String(rule.args.id)),
    shop: (rule, values) => rule.args?.id === undefined || String(values.shopId) === String(rule.args.id),
    state: (rule, values) => rule.args?.value === undefined || values.state === rule.args.value,
    config: (rule, values) => rule.args?.key === undefined || values[ String(rule.args.key) ] === rule.args?.value,
  }
  const evaluators = { ...builtIns, ...options.evaluators }
  const evaluateContext = async (entry: PermissionPolicyEntry, values: Record<string, unknown>): Promise<string | null> => {
    for (const rule of entry.contextRules) {
      const evaluator = evaluators[rule.evaluator]
      if (evaluator === undefined) return `unregistered evaluator ${rule.evaluator}`
      if (!await evaluator(rule, values)) return `context rule ${rule.evaluator}`
    }
    return null
  }
  return {
    policy: options.policy,
    async assert (capabilityId: string): Promise<void> {
      if (options.policy.status !== 'complete') {
        const error = new PermissionDeniedError(capabilityId, 'permission policy is incomplete', options.policy.revision)
        options.onDenied?.({ capabilityId, policyRevision: options.policy.revision, failedRule: error.failedRule }); throw error
      }
      const entry = options.policy.entries.find(candidate => candidate.capabilityId === capabilityId)
      if (entry === undefined) {
        const error = new PermissionDeniedError(capabilityId, 'accepted policy entry not found', options.policy.revision)
        options.onDenied?.({ capabilityId, policyRevision: options.policy.revision, failedRule: error.failedRule }); throw error
      }
      const permissions = await permissionCodes()
      if (!evaluatePermissionExpression(entry.pageChain, permissions)) { const error = new PermissionDeniedError(capabilityId, 'page permission chain', options.policy.revision); options.onDenied?.({ capabilityId, policyRevision: options.policy.revision, failedRule: error.failedRule }); throw error }
      if (!evaluatePermissionExpression(entry.actionChain, permissions)) { const error = new PermissionDeniedError(capabilityId, 'action permission chain', options.policy.revision); options.onDenied?.({ capabilityId, policyRevision: options.policy.revision, failedRule: error.failedRule }); throw error }
      const failedContext = await evaluateContext(entry, await context())
      if (failedContext !== null) { const error = new PermissionDeniedError(capabilityId, failedContext, options.policy.revision); options.onDenied?.({ capabilityId, policyRevision: options.policy.revision, failedRule: error.failedRule }); throw error }
    },
  }
}
export type PermissionGate = ReturnType<typeof createPermissionGate>
