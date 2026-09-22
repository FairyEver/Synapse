import { z } from "zod"
import type { ReturnTypeOfConnectorsService } from "../../../app-capabilities/connectors/main/service-types"
import type { AccountService } from "../../../electron/services/account-service"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { PORTAL_CREDENTIAL_ACTION } from "../shared/capability"

const grantSchema = z.object({ accessToken: z.string().min(1).max(8192), expiresAt: z.string().datetime() })
const inputSchema = z.object({}).strict()
const connectorId = "portal-headless-test"

export function createPortalHeadlessDispatcher(deps: {
  connectors: Pick<ReturnTypeOfConnectorsService, "getSessionInput">
  account: Pick<AccountService, "getState" | "fetchAuthenticated" | "getApiBaseUrlForLive">
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (action !== PORTAL_CREDENTIAL_ACTION) throw new Error("Unknown extension action")
      if (!inputSchema.safeParse(params).success) return { ok: false, error: "此工具不接受参数。" }
      if (context.source !== "mcp-http" && context.source !== "mcp-stdio") {
        return { ok: false, error: "扩展凭证仅通过本机 MCP 提供。" }
      }
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp" }
      const metadata = { source: context.source, capability: action }
      async function guarded<T>(permission: PermissionAction, resource: string, run: () => Promise<T>): Promise<T> {
        const check = await deps.permissionGuard.check({ action: permission, actor, resource, context: metadata })
        if (!check.allowed) {
          deps.auditSink.record({ action: permission, actor, resource, outcome: "denied", metadata })
          throw new Error("permission_denied")
        }
        try {
          const value = await run()
          deps.auditSink.record({ action: permission, actor, resource, outcome: "allowed", metadata })
          return value
        } catch {
          deps.auditSink.record({ action: permission, actor, resource, outcome: "failed", metadata })
          throw new Error("extension_request_failed")
        }
      }
      try {
        const state = deps.account.getState()
        if (state.status !== "authenticated" || state.profile.user.status !== "active") {
          return { ok: false, code: "SY_AUTH_REQUIRED", error: "请先登录 Synapse。" }
        }
        const initial = await guarded("secret.read", PORTAL_CREDENTIAL_ACTION,
          () => deps.connectors.getSessionInput(connectorId))
        const apiBaseUrl = `${deps.account.getApiBaseUrlForLive().replace(/\/$/, "")}/extend/portal-headless`
        const target = new URL(apiBaseUrl)
        if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) {
          throw new Error("invalid_backend")
        }
        const grant = await guarded("network.connect", target.origin, async () => {
          const timeout = AbortSignal.timeout(15_000)
          const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout
          const response = await deps.account.fetchAuthenticated("/extend/portal-headless/access", {
            method: "POST", signal, redirect: "error",
          }, "扩展授权获取失败。")
          return grantSchema.parse(await response.json())
        })
        const current = await deps.connectors.getSessionInput(connectorId)
        const currentAccount = deps.account.getState()
        if (context.abortSignal?.aborted || currentAccount.status !== "authenticated"
          || currentAccount.profile.user.id !== initial.userId || state.profile.user.id !== initial.userId
          || current.connectionGeneration !== initial.connectionGeneration
          || current.userId !== initial.userId) {
          return { ok: false, code: "CONNECTION_CHANGED", error: "账号或连接已变化，请重新获取凭证。" }
        }
        return { ok: true, data: {
          extensionId: "portal-headless", protocolVersion: 1, environment: "test", apiBaseUrl,
          authorization: { scheme: "Bearer", accessToken: grant.accessToken, expiresAt: grant.expiresAt },
          portal: { token: current.credential.token, tenantId: current.credential.tenantId, language: current.language },
        } }
      } catch {
        // Never send AccountService/SDK errors or request configuration across the credential boundary.
        return { ok: false, code: "CREDENTIAL_UNAVAILABLE", error: "无法获取扩展凭证，请检查 Synapse 登录、Portal Headless Test 连接与网络后重试。" }
      }
    },
  }
}
