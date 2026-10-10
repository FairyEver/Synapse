import { PORTAL_BASE_DATA_KEYS } from '../session/base-data.js'
import type { PortalSession } from '../session/session.js'
import type { ContextRule } from './policy.js'

/** Reuse Portal's tenant-scoped system cache and parser. */
export async function loadPermissionContext(session: PortalSession, rules: readonly ContextRule[]): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = { tenantId: session.key.tenantId }
  if (rules.some(rule => rule.evaluator === 'system')) {
    await session.ensure([PORTAL_BASE_DATA_KEYS.tenantSystem])
    values.systemIds = session.get(PORTAL_BASE_DATA_KEYS.tenantSystem)
  }
  // Shop selection, entity state and configuration require a reviewed trusted resolver.
  // Their absence is denied by the fixed evaluator, never filled from AI arguments.
  return values
}
