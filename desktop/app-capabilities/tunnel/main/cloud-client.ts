import { z } from "zod"
import type { AccountService } from "../../../electron/services/account-service"
import { TUNNEL_DEVICE_HEADER, TUNNEL_KEY_HEADER, type TunnelCreateInput, type TunnelListInput, type TunnelMappingDto, type TunnelPageDto, type TunnelUpdateInput, type TunnelEnableInput, type TunnelDeleteInput } from "@synapse/shared/tunnel-contracts"
import { tunnelDeletedSchema, tunnelMappingSchema, tunnelPageSchema } from "../shared/schema"
export type TunnelAccountClient = Pick<AccountService, "getState" | "onStateChanged" | "onBeforeIdentityChange" | "fetchAuthenticated" | "captureAccountRequestScope" | "getAccessTokenForLive" | "getApiBaseUrlForLive" | "refreshFromStorage">
export class TunnelAppError extends Error {
  constructor(readonly status: number, readonly code: string, message = "穿透请求失败") { super(message) }
}
export function tunnelFailure(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof TunnelAppError) return { status: error.status, code: error.code, message: error.message }
  return { status: 0, code: "TUNNEL_FAILED", message: error instanceof z.ZodError ? "穿透参数无效" : "穿透操作失败，请重试" }
}
export interface TunnelDeviceProof { clientInstanceId: string; key: string }
export class TunnelCloudClient {
  private generation = 0
  private readonly requests = new Set<AbortController>()
  private readonly unsubscribe: () => void
  constructor(private readonly account: TunnelAccountClient) { this.unsubscribe = account.onBeforeIdentityChange(() => this.reset()) }
  reset(): void { this.generation++; for (const request of this.requests) request.abort(); this.requests.clear() }
  dispose(): void { this.reset(); this.unsubscribe() }
  private async request<T>(path: string, method: string, schema: z.ZodType<T>, input?: unknown, proof?: TunnelDeviceProof): Promise<T> {
    const state = this.account.getState(), generation = this.generation, scope = this.account.captureAccountRequestScope()
    if (state.status !== "authenticated" || !scope) throw new TunnelAppError(401, "TUNNEL_AUTH_REQUIRED", "请先登录")
    const controller = new AbortController(); this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(), 30000); timer.unref()
    const current = () => { if (generation !== this.generation || this.account.getState().status !== "authenticated") throw new TunnelAppError(0, "TUNNEL_IDENTITY_CHANGED", "账号已变更") }
    try {
      const headers: Record<string, string> = {}
      if (input !== undefined) headers["Content-Type"] = "application/json"
      if (proof) { headers[TUNNEL_DEVICE_HEADER] = proof.clientInstanceId; headers[TUNNEL_KEY_HEADER] = proof.key }
      const response = await this.account.fetchAuthenticated(path, { method, headers, signal: controller.signal, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }, "穿透请求失败", scope)
      current()
      if (!response.ok) throw new TunnelAppError(response.status, "TUNNEL_HTTP_ERROR")
      const data = schema.safeParse(await response.json()); current()
      if (!data.success) throw new TunnelAppError(0, "TUNNEL_BAD_RESPONSE", "穿透数据无法读取")
      return data.data
    } catch (error) {
      current()
      if (error instanceof TunnelAppError) throw error
      const status = (error as { status?: number })?.status ?? 0
      const code = (error as { code?: string })?.code
      throw new TunnelAppError(status, typeof code === "string" && /^TUNNEL_[A-Z_]{1,60}$/u.test(code) ? code : "TUNNEL_NETWORK_ERROR", status === 401 ? "请先登录" : "穿透请求失败，请重试")
    } finally { clearTimeout(timer); this.requests.delete(controller) }
  }
  register(proof: TunnelDeviceProof): Promise<unknown> { return this.request("/tunnels/device", "PUT", z.object({ registered: z.literal(true) }), undefined, proof) }
  list(input: TunnelListInput): Promise<TunnelPageDto> {
    const query = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
    return this.request("/tunnels?" + query, "GET", tunnelPageSchema)
  }
  get(id: string): Promise<TunnelMappingDto> { return this.request("/tunnels/" + encodeURIComponent(id), "GET", tunnelMappingSchema) }
  operation(requestId: string): Promise<TunnelMappingDto> { return this.request("/tunnels/operations/" + encodeURIComponent(requestId), "GET", tunnelMappingSchema) }
  create(input: TunnelCreateInput, proof: TunnelDeviceProof): Promise<TunnelMappingDto> { return this.request("/tunnels", "POST", tunnelMappingSchema, input, proof) }
  update(id: string, input: TunnelUpdateInput, proof: TunnelDeviceProof): Promise<TunnelMappingDto> { return this.request("/tunnels/" + encodeURIComponent(id), "PATCH", tunnelMappingSchema, input, proof) }
  setEnabled(id: string, input: TunnelEnableInput, proof: TunnelDeviceProof): Promise<TunnelMappingDto> { return this.request("/tunnels/" + encodeURIComponent(id) + "/enabled", "PATCH", tunnelMappingSchema, input, proof) }
  delete(id: string, input: TunnelDeleteInput): Promise<{ id: string; deleted: true }> { return this.request("/tunnels/" + encodeURIComponent(id), "DELETE", tunnelDeletedSchema, input) }
}
