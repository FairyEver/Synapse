import { sendOutboundHttpRequest } from "../../../electron/runtime/network/outbound-http"
import { portalIdSchema } from "../shared/portal-contract"
import type { PortalIntegration } from "./types"
import { PortalConnectionError } from "./portal-errors"

export type PortalCredentialInput = { token: string; tenantId: string; portalUserId: string }
export type PortalProfile = { portalUserId: string; tenantId: string; displayName?: string; tenantName?: string }
export type PortalVerifier = (integration: PortalIntegration, credential: PortalCredentialInput, signal: AbortSignal) => Promise<PortalProfile>
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
function remoteId(value: unknown): string {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) throw new PortalConnectionError("invalid_response")
  const parsed = portalIdSchema.safeParse(String(value))
  if (!parsed.success) throw new PortalConnectionError("invalid_response")
  return parsed.data
}
function label(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 256) : undefined
}

export function createPortalVerifier(fetchImpl?: typeof fetch): PortalVerifier {
  return async (integration, credential, signal) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal.aborted) abort()
    signal.addEventListener("abort", abort, { once: true })
    const timeout = setTimeout(abort, 30_000)
    async function request(path: string): Promise<unknown> {
      try {
        const response = await sendOutboundHttpRequest({
          method: "GET", url: `${integration.baseUrl}${path}`, redirect: "manual",
          headers: { token: credential.token, "tenant-id": credential.tenantId, "Accept-Language": integration.language },
          timeoutMs: 15_000, abortSignal: controller.signal, maxResponseBodyBytes: 2 * 1024 * 1024, fetchImpl,
          // No raw errors/headers/response bodies enter the shared network logger.
        })
        if (response.status >= 300 && response.status < 400) throw new PortalConnectionError("redirect_not_allowed")
        if (response.status === 401) throw new PortalConnectionError("credential_invalid")
        if (response.status === 403) throw new PortalConnectionError("permission_denied")
        if (response.status >= 500) throw new PortalConnectionError("network_error")
        if (response.status !== 200) throw new PortalConnectionError("invalid_response")
        let body: unknown
        try { body = JSON.parse(response.body) } catch { throw new PortalConnectionError("invalid_response") }
        if (!record(body)) throw new PortalConnectionError("invalid_response")
        if (Number(body.code) === 1002015001) throw new PortalConnectionError("tenant_unavailable")
        if ([401, 10001].includes(Number(body.code))) throw new PortalConnectionError("credential_invalid")
        if (Number(body.code) === 403) throw new PortalConnectionError("permission_denied")
        if (body.ret !== "SUCCESS") throw new PortalConnectionError("invalid_response")
        return body.data
      } catch (error) {
        if (error instanceof PortalConnectionError) throw error
        throw new PortalConnectionError(controller.signal.aborted || (error instanceof Error && error.name === "AbortError") ? "verification_timeout" : "network_error")
      }
    }
    try {
      const user = await request("/admin-api/sys/user/info")
      if (!record(user)) throw new PortalConnectionError("invalid_response")
      const portalUserId = remoteId(user.id)
      if (portalUserId !== credential.portalUserId) throw new PortalConnectionError("identity_mismatch")
      for (let pageNo = 1; pageNo <= 100; pageNo++) {
        const page = await request(`/admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=${pageNo}&pageSize=200`)
        if (!record(page) || !Array.isArray(page.list)) throw new PortalConnectionError("invalid_response")
        for (const tenant of page.list) {
          if (!record(tenant)) throw new PortalConnectionError("invalid_response")
          if (remoteId(tenant.id) === credential.tenantId) {
            return { portalUserId, tenantId: credential.tenantId, displayName: label(user.realName) ?? label(user.username), tenantName: label(tenant.name) }
          }
        }
        if (page.list.length < 200) throw new PortalConnectionError("tenant_mismatch")
      }
      throw new PortalConnectionError("invalid_response")
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
    }
  }
}
