import { z } from "zod"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { PermissionGuard, AuditSink } from "../../../electron/runtime/security"
import { MAIL_DEFINITIONS } from "../shared/capability"
import { MAIL_INPUT_SCHEMAS } from "../shared/schema"
import { MailError, type MailAction, type MailContext, type MailInputs, type MailResults } from "../shared/types"
type Service = { context(actor: MailContext["actor"]): MailContext; execute<K extends MailAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> }
export function mailFailure(error: unknown) {
  if (error instanceof z.ZodError) return { code: "INVALID_INPUT", message: "邮箱参数无效" }
  if (error instanceof MailError) return { code: error.code, message: error.message, details: error.details }
  return { code: "MAIL_FAILED", message: "邮箱操作失败，请重试或检查连接" }
}
export function createMailCapabilityDispatcher(deps: { service: Service; permissionGuard: PermissionGuard; auditSink: AuditSink }) {
  return { async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
    const key = action.startsWith("app.mail.") ? action.slice(9) as MailAction : null
    if (!key || !Object.hasOwn(MAIL_DEFINITIONS, key)) return { ok: false, code: "UNKNOWN_ACTION", error: "未知邮箱操作" }
    const definition = MAIL_DEFINITIONS[key]
    try {
      const input = MAIL_INPUT_SCHEMAS[key].parse(params), ctx = deps.service.context("mcp")
      const actor = context.actor ?? { kind: "user" as const, id: ctx.ownerId }
      const permission = await deps.permissionGuard.check({ action: definition.permission, actor, resource: definition.id, context: { domain: "mail", source: context.source ?? "api" } })
      deps.auditSink.record({ action: definition.permission, actor, resource: definition.id, outcome: permission.allowed ? "allowed" : "denied", metadata: { domain: "mail" } })
      if (!permission.allowed) throw new MailError("PERMISSION_DENIED", "此邮箱操作未获授权")
      const operationCtx = { ...ctx, shareCaller: { actor, clientId: context.clientId, source: context.source }, signal: context.abortSignal ? AbortSignal.any([ctx.signal, context.abortSignal]) : ctx.signal }
      const value = await deps.service.execute(operationCtx, key, input)
      return { ok: true, data: { externalData: true, value } }
    } catch (error) { const failure = mailFailure(error); return { ok: false, code: failure.code, error: failure.message, data: failure.details } }
  } }
}
