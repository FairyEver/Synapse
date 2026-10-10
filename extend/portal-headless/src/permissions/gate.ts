import type { PortalRequest } from '../session/types.js'
import type { PortalSession } from '../session/session.js'
import { BASE_DATA_KEYS } from '../capabilities/base-dept-dict-permission.js'
import { evaluatePermissionExpression, loadPermissionSourcePin, validatePermissionPolicy, type ContextRule, type PermissionPolicy } from './policy.js'

export class PermissionDeniedError extends Error {
  readonly code = 403
  constructor(readonly capabilityId: string, readonly failedRule: string, readonly policyRevision: string | null) {
    super(`PH capability ${capabilityId} 被权限闸门拒绝：${failedRule}`)
    this.name = 'PermissionDeniedError'
  }
}
export type PermissionGateOptions = {
  policy: PermissionPolicy | null
  request: PortalRequest
  /** Trusted server configuration, never invocation arguments. */
  sourcePin?: { sourceRevision: string; sdkSourceRevision: string }
  permissionCodes?: () => Promise<ReadonlySet<string>>
  context?: (rules: readonly ContextRule[]) => Promise<Record<string, unknown>>
  onDenied?: (event: { capabilityId: string; policyRevision: string | null; failedRule: string }) => void
}
function extractCodes(payload: unknown): Set<string> {
  if (!Array.isArray(payload) || payload.some(code => typeof code !== 'string')) throw new Error('invalid permission response')
  return new Set(payload as string[])
}
/** Permission facts share the SDK user-session cache; authorization decisions do not. */
export async function loadSessionPermissionCodes(session: PortalSession): Promise<ReadonlySet<string>> {
  await session.ensure([BASE_DATA_KEYS.permission])
  try { return extractCodes(session.get(BASE_DATA_KEYS.permission)) } catch (error) {
    session.invalidate(BASE_DATA_KEYS.permission)
    throw error
  }
}
function evaluateContext(rule: ContextRule, values: Record<string, unknown>): boolean {
  const args = rule.args!
  const has = (key: string): boolean => Object.hasOwn(values, key) && values[key] !== undefined && values[key] !== null
  const matches = (key: string): boolean => has(key) && String(values[key]) === String(args.id)
  switch (rule.evaluator) {
    case 'tenant': return matches('tenantId')
    case 'shop': return matches('shopId')
    case 'system': return has('systemIds') && Array.isArray(values.systemIds) && values.systemIds.some(id => (typeof id === 'string' || typeof id === 'number') && String(id) === String(args.id))
    case 'state': return has('state') && values.state === args.value
    case 'config': return has('config') && !!values.config && typeof values.config === 'object' && Object.hasOwn(values.config, String(args.key)) && (values.config as Record<string, unknown>)[String(args.key)] === args.value
    default: return false
  }
}
export function createPermissionGate(options: PermissionGateOptions) {
  const sourcePin = { ...(options.sourcePin ?? loadPermissionSourcePin()) }
  // Detach from mutable configuration so callers cannot change a policy after validation.
  let policy: PermissionPolicy | null = null
  try { policy = JSON.parse(JSON.stringify(options.policy)) as PermissionPolicy | null } catch { policy = null }
  const permissionCodes = options.permissionCodes ?? (async () => extractCodes(await options.request({ url: '/admin-api/sys/menu/permissionsNotBySystem', method: 'get' })))
  return {
    async assert(capabilityId: string): Promise<void> {
      const revision = policy && typeof policy.revision === 'string' ? policy.revision : null
      const deny = (failedRule: string): never => {
        const error = new PermissionDeniedError(capabilityId, failedRule, revision)
        options.onDenied?.({ capabilityId, policyRevision: revision, failedRule })
        throw error
      }
      try { validatePermissionPolicy(policy, sourcePin) } catch { deny('policy missing, invalid, incomplete or stale') }
      const entry = policy!.entries.find(candidate => candidate.capabilityId === capabilityId)
      if (!entry) deny('accepted policy entry not found')
      let permissions: ReadonlySet<string>
      try { permissions = await permissionCodes() } catch { deny('current permissions unavailable') }
      if (!evaluatePermissionExpression(entry!.pageChain, permissions!)) deny('page permission chain')
      if (!evaluatePermissionExpression(entry!.actionChain, permissions!)) deny('action permission chain')
      if (entry!.contextRules.length) {
        let values: Record<string, unknown>
        try {
          values = await (options.context?.(entry!.contextRules) ?? Promise.resolve({}))
          if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('invalid trusted business context')
        } catch { deny('trusted business context unavailable') }
        for (const rule of entry!.contextRules) if (!evaluateContext(rule, values!)) deny(`context rule ${rule.evaluator}`)
      }
    },
  }
}
export type PermissionGate = ReturnType<typeof createPermissionGate>
