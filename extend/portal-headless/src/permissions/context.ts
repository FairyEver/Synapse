import { createPortalBaseDataRegistry } from '../session/base-data.js'
import type { PortalSession } from '../session/session.js'
import type { ContextRule } from './policy.js'

/** Reuse Portal's system parser, but load again for every authorization decision. */
export async function loadPermissionContext(session: PortalSession, rules: readonly ContextRule[]): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = { tenantId: session.key.tenantId }
  if (rules.some(rule => rule.evaluator === 'system')) {
    const loader = createPortalBaseDataRegistry().get('tenant-system')!
    values.systemIds = await loader.load({ key: loader.key, request: session.request, credential: session.credential,
      now: Date.now(), session, get: key => session.get(key), has: key => session.has(key) })
  }
  // Shop selection, entity state and configuration require a reviewed trusted resolver.
  // Their absence is denied by the fixed evaluator, never filled from AI arguments.
  return values
}
