import { createHash } from "node:crypto"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { SkillHubDesktopError } from "./error"

export type SkillHubCaller = {
  actor: ActorIdentity
  clientId: string
  signal?: AbortSignal
}
export type HubSecurity = { guard: PermissionGuard; audit: AuditSink }
export const hubKey = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
export const hubCallerKey = (caller: SkillHubCaller) => hubKey([caller.actor.kind, caller.actor.id, caller.clientId])

export async function withHubPermission<T>(
  security: HubSecurity, caller: SkillHubCaller, action: PermissionAction, resource: string, operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const context = { source: "skill-hub", operation }
  const safeResource = action === "network.connect" ? resource : `skill-hub-file:${hubKey(resource)}`
  const allowed = await security.guard.check({ action, actor: caller.actor, resource, context })
  if (!allowed.allowed) {
    security.audit.record({ action, actor: caller.actor, resource: safeResource, outcome: "denied", metadata: context })
    throw new SkillHubDesktopError("HUB_FORBIDDEN", "当前调用者无权执行该 Skill Hub 操作。")
  }
  try {
    const result = await run()
    security.audit.record({ action, actor: caller.actor, resource: safeResource, outcome: "allowed", metadata: context })
    return result
  } catch (error) {
    security.audit.record({ action, actor: caller.actor, resource: safeResource, outcome: "failed", metadata: context })
    throw error
  }
}
