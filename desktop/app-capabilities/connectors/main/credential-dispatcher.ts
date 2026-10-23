import { z } from "zod"
import type { AccountService } from "../../../electron/services/account-service"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { PORTAL_LINK_CREDENTIAL_CAPABILITY_ID, PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID } from "../shared/capability"
import { portalConnector, portalTestConnector } from "./definitions"
import type { ReturnTypeOfConnectorsService } from "./service-types"

const emptyInput = z.object({}).strict()

export function createPortalCredentialDispatcher(deps: {
  connectors: Pick<ReturnTypeOfConnectorsService, "getSessionInput">
  account: Pick<AccountService, "getState">
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const definition = action === PORTAL_LINK_CREDENTIAL_CAPABILITY_ID ? portalConnector
        : action === PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID ? portalTestConnector : null
      if (!definition) throw new Error("Unknown connector credential action")
      if (!emptyInput.safeParse(params).success) return { ok: false, code: "INVALID_INPUT", error: "此凭证工具不接受参数。" }
      if (context.source !== "mcp-http" && context.source !== "mcp-stdio") {
        return { ok: false, code: "MCP_REQUIRED", error: "Portal 凭证仅通过本机 MCP 提供。" }
      }
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp" }
      const metadata = { source: context.source, capability: action }
      const unavailable = (): DispatchResult => ({ ok: false, code: "CREDENTIAL_UNAVAILABLE", error: `无法获取凭证，请检查 Synapse 登录及 ${definition.name} 连接后重试。` })
      const audit = (outcome: "allowed" | "denied" | "failed") => deps.auditSink.record({ action: "secret.read", actor, resource: action, outcome, metadata })
      try {
        const state = deps.account.getState()
        if (state.status !== "authenticated" || state.profile.user.status !== "active") {
          return { ok: false, code: "SY_AUTH_REQUIRED", error: "请先登录 Synapse。" }
        }
        const permission = await deps.permissionGuard.check({ action: "secret.read", actor, resource: action, context: metadata })
        if (!permission.allowed) {
          audit("denied")
          return { ok: false, code: "PERMISSION_DENIED", error: "没有权限读取 Portal 凭证。" }
        }
        const initial = await deps.connectors.getSessionInput(definition.id)
        const current = await deps.connectors.getSessionInput(definition.id)
        const account = deps.account.getState()
        if (context.abortSignal?.aborted || account.status !== "authenticated" || account.profile.user.status !== "active"
          || account.profile.user.id !== initial.userId || state.profile.user.id !== initial.userId
          || current.userId !== initial.userId || current.connectionGeneration !== initial.connectionGeneration
          || initial.environmentId !== definition.integration.environmentId || current.environmentId !== definition.integration.environmentId) {
          audit("failed")
          return { ok: false, code: "CONNECTION_CHANGED", error: "账号或连接已变化，请重新获取凭证。" }
        }
        audit("allowed")
        return { ok: true, data: {
          environment: current.environmentId, baseUrl: current.baseUrl, language: current.language,
          token: current.credential.token, tenantId: current.credential.tenantId,
          portalUserId: current.account.portalUserId,
          ...(current.account.displayName === undefined ? {} : { displayName: current.account.displayName }),
          ...(current.account.tenantName === undefined ? {} : { tenantName: current.account.tenantName }),
        } }
      } catch {
        try { audit("failed") }
        catch { return unavailable() }
        return unavailable()
      }
    },
  }
}
