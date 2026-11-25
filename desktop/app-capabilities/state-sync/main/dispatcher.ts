import { STATE_SYNC_DOC_MAX_BYTES } from "@synapse/shared/state-sync-contracts"
import type { AccountService } from "../../../electron/services/account-service"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { mcpClientActorForSource, type DispatchContext, type DispatchResult } from "../../../synapse-capabilities/shared/types"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { isStateSyncAction, stateSyncOperations } from "../shared/capability"

type StateSyncAccount = Pick<AccountService, "captureAccountRequestScope" | "onBeforeIdentityChange" | "fetchAuthenticated">
type Dependencies = {
  account: StateSyncAccount
  permissionGuard: Pick<PermissionGuard, "check">
  auditSink: Pick<AuditSink, "record">
}

const MAX_STATE_SYNC_REQUEST_BYTES = STATE_SYNC_DOC_MAX_BYTES

const failure = (code: string, error: string, data?: unknown): DispatchResult =>
  ({ ok: false, code, error, ...(data === undefined ? {} : { data }) })

function describeFailure(error: unknown): DispatchResult {
  const remote = error as {
    status?: number
    code?: string
    requestId?: string
    retryAfterMs?: number
    currentRev?: number
  } | null
  if (remote?.status === 401 || (error instanceof Error && error.name === "AccountAuthenticationRequiredError")) {
    return failure("STATE_SYNC_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录后重试。")
  }
  if (typeof remote?.status === "number") {
    const { status, requestId, retryAfterMs, currentRev } = remote
    const code = typeof remote.code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/u.test(remote.code)
      ? remote.code
      : "STATE_SYNC_REJECTED"
    return failure(code, "状态同步服务拒绝了请求，请根据错误码处理。", {
      status,
      ...(requestId && /^[A-Za-z0-9_-]{1,128}$/u.test(requestId) ? { requestId } : {}),
      ...(typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
      ...(typeof currentRev === "number" && Number.isFinite(currentRev) ? { currentRev } : {}),
    })
  }
  return failure("STATE_SYNC_REQUEST_FAILED", "未能确认状态同步请求结果，请检查网络连接后重试。")
}

export function createStateSyncCapabilityDispatcher({ account, permissionGuard, auditSink }: Dependencies) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (!isStateSyncAction(action)) return failure("STATE_SYNC_UNKNOWN_ACTION", "未知的状态同步操作。")
      const source = context.source
      if (source !== "mcp-http" && source !== "mcp-stdio") {
        return failure("STATE_SYNC_FORBIDDEN", "状态同步能力仅供 Synapse MCP 调用。")
      }
      const operation = stateSyncOperations[action]
      const invalidInput = () => failure("STATE_SYNC_INVALID_INPUT", "状态同步参数不符合该工具的输入契约。")
      let parsed: { success: true; data: Record<string, unknown> } | { success: false }
      try {
        parsed = operation.input.safeParse(params) as typeof parsed
      } catch (error) {
        if (error instanceof RangeError) return invalidInput()
        throw error
      }
      if (!parsed.success) return invalidInput()

      const scope = account.captureAccountRequestScope()
      if (!scope) return failure("STATE_SYNC_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录并确认在线。")

      const dataRecord = parsed.data
      const pathSpaceId = operation.path.includes(":spaceId") ? dataRecord.spaceId : undefined
      const pathTokenId = operation.path.includes(":tokenId") ? dataRecord.tokenId : undefined
      const pathDocId = operation.path.includes(":docId") ? dataRecord.docId : undefined

      let path = "/console/state-sync" + operation.path
        .replace(":spaceId", () => String(pathSpaceId))
        .replace(":tokenId", () => String(pathTokenId))
        .replace(":docId", () => encodeURIComponent(String(pathDocId)))

      if ("query" in operation && operation.query) {
        const searchParams = new URLSearchParams()
        for (const key of Object.keys(operation.query)) {
          const val = dataRecord[key]
          if (val !== undefined) {
            searchParams.set(key, String(val))
          }
        }
        const qs = searchParams.toString()
        if (qs) path += `?${qs}`
      }

      const headers = new Headers()
      let body: string | undefined
      if ("body" in operation && operation.body) {
        const excluded = new Set<string>([
          ...(operation.path.includes(":spaceId") ? ["spaceId"] : []),
          ...(operation.path.includes(":tokenId") ? ["tokenId"] : []),
          ...(operation.path.includes(":docId") ? ["docId"] : []),
          ...("query" in operation && operation.query ? Object.keys(operation.query) : []),
        ])
        const bodyValues = Object.fromEntries(
          Object.entries(dataRecord).filter(([key, value]) => !excluded.has(key) && value !== undefined),
        )
        body = JSON.stringify(bodyValues)
        if (Buffer.byteLength(body) > MAX_STATE_SYNC_REQUEST_BYTES) {
          return failure("REQUEST_TOO_LARGE", "状态同步请求体不能超过 256 KiB。")
        }
        headers.set("Content-Type", "application/json")
      }

      const actor = context.actor ?? mcpClientActorForSource(source)
      const metadata = { source, operation: action }
      const resource = "synapse-state-sync"
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

      try {
        const permission = await permissionGuard.check({ ...security, context: metadata })
        if (!permission.allowed) {
          audit("denied")
          return failure("STATE_SYNC_FORBIDDEN", "当前调用者无权访问状态同步。")
        }
        if (changed()) {
          audit("failed")
          return failure("STATE_SYNC_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标同步空间。")
        }
        signal.throwIfAborted()
        const response = await account.fetchAuthenticated(path, {
          method: operation.method,
          headers,
          body,
          signal,
          redirect: "error",
          credentials: "omit",
        }, "状态同步请求失败。", scope)
        if (changed() || signal.aborted) {
          await response.body?.cancel()
          throw signal.reason ?? new Error("State sync account changed")
        }
        const data: unknown = await response.json()
        if (changed() || signal.aborted) throw signal.reason ?? new Error("State sync account changed")
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid state sync response")
        }
        if (action === "app.state_sync.publish_preflight.get") {
          const preflight = data as { accountId?: unknown; publicAppUrl?: unknown; audience?: unknown }
          if (preflight.accountId !== scope.accountId) throw new Error("Unexpected preflight account")
          const desktopOrigin = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin
          let preflightOrigin = typeof preflight.publicAppUrl === "string" ? preflight.publicAppUrl : null
          if (preflightOrigin) {
            try {
              preflightOrigin = new URL(preflightOrigin).origin
            } catch {
              // Keep raw string so malformed server URLs trigger environment_mismatch.
            }
          }
          if (preflightOrigin && preflightOrigin !== desktopOrigin) {
            audit("allowed")
            return {
              ok: true,
              data: { ...preflight, audience: "environment_mismatch", desktopPublicAppUrl: desktopOrigin },
            }
          }
        }
        audit("allowed")
        return { ok: true, data }
      } catch (error) {
        audit("failed")
        if (changed()) return failure("STATE_SYNC_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标同步空间。")
        if (action === "app.state_sync.publish_preflight.get" && (error as { status?: number } | null)?.status === 404) {
          return failure("STATE_SYNC_PREFLIGHT_UNAVAILABLE", "当前状态同步服务不支持发布前检查，请检查客户端和服务版本。")
        }
        return context.abortSignal?.aborted
          ? failure("STATE_SYNC_CANCELLED", "状态同步请求已取消。")
          : describeFailure(error)
      } finally {
        unsubscribe()
      }
    },
  }
}
