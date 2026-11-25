import type { AccountService } from "../../../electron/services/account-service"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { mcpClientActorForSource, type DispatchContext, type DispatchResult } from "../../../synapse-capabilities/shared/types"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { channelOperations, isChannelAction } from "../shared/capability"

type ChannelAccount = Pick<AccountService, "captureAccountRequestScope" | "onBeforeIdentityChange" | "fetchAuthenticated">
type Dependencies = {
  account: ChannelAccount
  permissionGuard: Pick<PermissionGuard, "check">
  auditSink: Pick<AuditSink, "record">
}

const MAX_CHANNEL_REQUEST_BYTES = 128 * 1024

const failure = (code: string, error: string, data?: unknown): DispatchResult =>
  ({ ok: false, code, error, ...(data === undefined ? {} : { data }) })

function describeFailure(error: unknown): DispatchResult {
  const remote = error as { status?: number; code?: string; requestId?: string; retryAfterMs?: number } | null
  if (remote?.status === 401 || (error instanceof Error && error.name === "AccountAuthenticationRequiredError")) {
    return failure("CHANNEL_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录后重试。")
  }
  if (typeof remote?.status === "number") {
    const { status, requestId, retryAfterMs } = remote
    const code = typeof remote.code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/u.test(remote.code) ? remote.code : "CHANNEL_REJECTED"
    return failure(code, "频道服务拒绝了请求，请根据错误码处理。", {
      status,
      ...(requestId && /^[A-Za-z0-9_-]{1,128}$/u.test(requestId) ? { requestId } : {}),
      ...(typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
    })
  }
  return failure("CHANNEL_REQUEST_FAILED", "未能确认频道请求结果，请检查网络连接后重试。")
}

export function createChannelCapabilityDispatcher({ account, permissionGuard, auditSink }: Dependencies) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (!isChannelAction(action)) return failure("CHANNEL_UNKNOWN_ACTION", "未知的频道操作。")
      const source = context.source
      if (source !== "mcp-http" && source !== "mcp-stdio") {
        return failure("CHANNEL_FORBIDDEN", "频道能力仅供 Synapse MCP 调用。")
      }
      const operation = channelOperations[action]
      const invalidInput = () => failure("CHANNEL_INVALID_INPUT", "频道参数不符合该工具的输入契约。")
      let parsed: { success: true; data: Record<string, unknown> } | { success: false }
      try {
        parsed = operation.input.safeParse(params) as typeof parsed
      } catch (error) {
        if (error instanceof RangeError) return invalidInput()
        throw error
      }
      if (!parsed.success) return invalidInput()

      const scope = account.captureAccountRequestScope()
      if (!scope) return failure("CHANNEL_ACCOUNT_REQUIRED", "请在 Synapse 桌面端登录并确认在线。")

      const { channelId, tokenId, ...rest } = parsed.data
      const pathEvent = operation.path.includes(":event") ? rest.event : undefined
      const bodyValues = operation.path.includes(":event")
        ? Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "event"))
        : rest

      const path = "/console/channels" + operation.path
        .replace(":channelId", () => String(channelId))
        .replace(":tokenId", () => String(tokenId))
        .replace(":event", () => encodeURIComponent(String(pathEvent)))

      const headers = new Headers()
      const body = operation.body ? JSON.stringify(bodyValues) : undefined
      if (body !== undefined) {
        if (Buffer.byteLength(body) > MAX_CHANNEL_REQUEST_BYTES) {
          return failure("REQUEST_TOO_LARGE", "频道请求体不能超过 128 KiB。")
        }
        headers.set("Content-Type", "application/json")
      }

      const actor = context.actor ?? mcpClientActorForSource(source)
      const metadata = { source, operation: action }
      const resource = "synapse-channels"
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
          return failure("CHANNEL_FORBIDDEN", "当前调用者无权访问频道。")
        }
        if (changed()) {
          audit("failed")
          return failure("CHANNEL_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标频道。")
        }
        signal.throwIfAborted()
        const response = await account.fetchAuthenticated(path, {
          method: operation.method,
          headers,
          body,
          signal,
          redirect: "error",
          credentials: "omit",
        }, "频道请求失败。", scope)
        if (changed() || signal.aborted) {
          await response.body?.cancel()
          throw signal.reason ?? new Error("Channel account changed")
        }
        const data: unknown = await response.json()
        if (changed() || signal.aborted) throw signal.reason ?? new Error("Channel account changed")
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid channel response")
        }
        if (action === "app.channels.publish_preflight.get") {
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
        if (changed()) return failure("CHANNEL_ACCOUNT_CHANGED", "Synapse 登录账号已变化，请重新确认目标频道。")
        if (action === "app.channels.publish_preflight.get" && (error as { status?: number } | null)?.status === 404) {
          return failure("CHANNEL_PREFLIGHT_UNAVAILABLE", "当前频道服务不支持发布前检查，请检查客户端和服务版本。")
        }
        return context.abortSignal?.aborted
          ? failure("CHANNEL_CANCELLED", "频道请求已取消。")
          : describeFailure(error)
      } finally {
        unsubscribe()
      }
    },
  }
}
