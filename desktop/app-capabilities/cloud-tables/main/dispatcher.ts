import { randomUUID } from "node:crypto"
import type { AccountService } from "../../../electron/services/account-service"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { mcpClientActorForSource, type DispatchContext, type DispatchResult } from "../../../synapse-capabilities/shared/types"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { cloudTableOperations, isCloudTableAction } from "../shared/capability"

type CloudTableAccount = Pick<AccountService, "captureAccountRequestScope" | "onBeforeIdentityChange" | "fetchAuthenticated">
type Dependencies = {
  account: CloudTableAccount
  permissionGuard: Pick<PermissionGuard, "check">
  auditSink: Pick<AuditSink, "record">
}

const failure = (code: string, error: string, data?: unknown): DispatchResult =>
  ({ ok: false, code, error, ...(data === undefined ? {} : { data }) })

function describeFailure(error: unknown): DispatchResult {
  const remote = error as { status?: number; code?: string; requestId?: string; retryAfterMs?: number } | null
  if (remote?.status === 401 || (error instanceof Error && error.name === "AccountAuthenticationRequiredError")) {
    return failure("CLOUD_TABLE_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录后重试。")
  }
  if (typeof remote?.status === "number") {
    const { status, requestId, retryAfterMs } = remote
    const code = typeof remote.code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/u.test(remote.code) ? remote.code : "CLOUD_TABLE_REJECTED"
    return failure(code, "云表服务拒绝了请求，请根据错误码处理。", {
      status,
      ...(requestId && /^[A-Za-z0-9_-]{1,128}$/u.test(requestId) ? { requestId } : {}),
      ...(typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
    })
  }
  return failure("CLOUD_TABLE_REQUEST_FAILED", "未能确认云表请求结果。若此写入支持幂等键，请用原参数和原键重试。")
}

export function createCloudTableCapabilityDispatcher({ account, permissionGuard, auditSink }: Dependencies) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (!isCloudTableAction(action)) return failure("CLOUD_TABLE_UNKNOWN_ACTION", "未知的云表操作。")
      const source = context.source
      if (source !== "mcp-http" && source !== "mcp-stdio") {
        return failure("CLOUD_TABLE_FORBIDDEN", "云表能力仅供 Synapse MCP 调用。")
      }
      const operation = cloudTableOperations[action]
      const invalidInput = () => failure("CLOUD_TABLE_INVALID_INPUT", "云表参数不符合该工具的输入契约。")
      let input
      try {
        input = operation.input.safeParse(params)
      } catch (error) {
        if (error instanceof RangeError) return invalidInput()
        throw error
      }
      if (!input.success) return invalidInput()

      const scope = account.captureAccountRequestScope()
      if (!scope) return failure("CLOUD_TABLE_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录并确认在线。")

      const { tableId, recordId, idempotencyKey, cursor, ...values } = input.data
      let path = "/console/tables" + operation.path
        .replace(":tableId", () => String(tableId))
        .replace(":recordId", () => String(recordId))
      if (operation.cursor && typeof cursor === "string") path += "?" + new URLSearchParams({ cursor })
      const headers = new Headers()
      const body = operation.body ? JSON.stringify({
        ...values, ...(!operation.cursor && cursor !== undefined ? { cursor } : {}),
      }) : undefined
      if (body !== undefined) {
        if (Buffer.byteLength(body) > 1024 * 1024) return failure("REQUEST_TOO_LARGE", "云表请求不能超过 1 MiB。")
        headers.set("Content-Type", "application/json")
      }
      const writeKey = operation.idempotent ? String(idempotencyKey ?? randomUUID()) : undefined
      if (writeKey) headers.set("Idempotency-Key", writeKey)

      const actor = context.actor ?? mcpClientActorForSource(source)
      const metadata = { source, operation: action }
      const resource = "synapse-cloud-tables"
      const security = { action: "network.connect", actor, resource } as const
      const audit = (outcome: "allowed" | "denied" | "failed") => auditSink.record({ ...security, outcome, metadata })

      const identity = new AbortController()
      const unsubscribe = account.onBeforeIdentityChange(() => identity.abort())
      const signal = AbortSignal.any([
        identity.signal,
        AbortSignal.timeout(30000),
        ...(context.abortSignal ? [context.abortSignal] : []),
      ])
      const changed = () => {
        const current = account.captureAccountRequestScope()
        return identity.signal.aborted || current?.accountId !== scope.accountId || current.authRevision !== scope.authRevision
      }
      let sent = false
      try {
        const permission = await permissionGuard.check({ ...security, context: metadata })
        if (!permission.allowed) {
          audit("denied")
          return failure("CLOUD_TABLE_FORBIDDEN", "当前调用者无权访问云表。")
        }
        if (changed()) {
          audit("failed")
          return failure("CLOUD_TABLE_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标表。")
        }
        signal.throwIfAborted()
        sent = true
        const response = await account.fetchAuthenticated(path, {
          method: operation.method, headers, body, signal, redirect: "error", credentials: "omit",
        }, "云表请求失败。", scope)
        if (changed() || signal.aborted) {
          await response.body?.cancel()
          throw signal.reason ?? new Error("Cloud table account changed")
        }
        const data: unknown = await response.json()
        if (changed() || signal.aborted) throw signal.reason ?? new Error("Cloud table account changed")
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid cloud table response")
        if (action === "app.cloud_tables.publish_preflight.get") {
          const preflight = data as { accountId?: unknown; publicAppUrl?: unknown; audience?: unknown }
          if (preflight.accountId !== scope.accountId) throw new Error("Unexpected preflight account")
          const desktopOrigin = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin
          if (typeof preflight.publicAppUrl === "string" && preflight.publicAppUrl !== desktopOrigin) {
            audit("allowed")
            return { ok: true, data: { ...preflight, audience: "environment_mismatch", desktopPublicAppUrl: desktopOrigin } }
          }
        }
        audit("allowed")
        return { ok: true, data }
      } catch (error) {
        audit("failed")
        if (changed()) return failure("CLOUD_TABLE_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标表。")
        if (action === "app.cloud_tables.publish_preflight.get" && (error as { status?: number } | null)?.status === 404) {
          return failure("CLOUD_TABLE_PREFLIGHT_UNAVAILABLE", "当前云表服务不支持发布前检查，请检查客户端和服务版本。")
        }
        const result = context.abortSignal?.aborted
          ? failure("CLOUD_TABLE_CANCELLED", "云表请求已取消。")
          : describeFailure(error)
        // Return the generated key if dispatch may have reached the server. A retry can reuse it.
        if (sent && writeKey && !result.ok) return { ...result, data: { ...(result.data as object | undefined), idempotencyKey: writeKey } }
        return result
      } finally {
        unsubscribe()
      }
    },
  }
}
