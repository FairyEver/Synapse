import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { MailError, type MailContext } from "../shared/types"
import type { MailAccess } from "./assets"

export class MailContextProvider {
  private owner: string | null = null
  private generation = 0
  private controller = new AbortController()
  constructor(private readonly resolveOwner: () => string | null) {}
  refreshIdentity(): void {
    const owner = this.resolveOwner()
    if (owner !== this.owner) {
      this.controller.abort()
      this.controller = new AbortController()
      this.owner = owner
      this.generation++
    }
  }
  current(actor: MailContext["actor"]): MailContext {
    this.refreshIdentity()
    if (!this.owner) throw new MailError("AUTH_REQUIRED", "请先登录 Synapse")
    return { ownerId: this.owner, generation: this.generation, signal: this.controller.signal, actor }
  }
  assertCurrent(ctx: MailContext): void {
    this.refreshIdentity()
    if (ctx.signal.aborted || ctx.ownerId !== this.owner || ctx.generation !== this.generation) throw new MailError("IDENTITY_CHANGED", "邮箱身份已变化")
  }
  status(): { ownerId: string | null; generation: number } { this.refreshIdentity(); return { ownerId: this.owner, generation: this.generation } }
  dispose(): void { this.controller.abort() }
}

export function createMailAccess(context: MailContextProvider, guard: PermissionGuard, audit: AuditSink): MailAccess {
  return async (ctx, action, resource) => {
    context.assertCurrent(ctx)
    const actor = ctx.actor === "sync" ? { kind: "system" as const, id: ctx.ownerId } : { kind: "user" as const, id: ctx.ownerId }
    const result = await guard.check({ action, actor, resource, context: { domain: "mail", source: ctx.actor, ownerId: ctx.ownerId } })
    audit.record({ action, actor, resource, outcome: result.allowed ? "allowed" : "denied", metadata: { domain: "mail", source: ctx.actor } })
    context.assertCurrent(ctx)
    if (!result.allowed) throw new MailError("PERMISSION_DENIED", "此邮箱操作未获授权")
  }
}

export const mailBackgroundPolicy: import("../../../electron/runtime/security").PermissionPolicy = {
  id: "mail-background",
  decide(request) {
    const allowed = ["network.connect", "secret.read", "secret.write", "fs.write", "content.read", "content.mutate", "notification.trigger"]
    return request.actor.kind === "system" && request.actor.id === request.context.ownerId && typeof request.actor.id === "string" && request.context.domain === "mail" && request.context.source === "sync" && allowed.includes(request.action) ? "allow" : "defer-to-next"
  },
}
