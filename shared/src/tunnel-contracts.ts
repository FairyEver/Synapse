/** 穿透的资源预算；服务端与桌面共用，不能通过单端放宽绕过云端限制。 */
export const TUNNEL_LIMITS = Object.freeze({ mappingsPerUser: 100, streamsPerMapping: 16, streamsPerUser: 64, streamsGlobal: 256,
  requestBodyBytes: 64 * 1024 * 1024, controlFrameBytes: 8 * 1024, dataMessageBytes: 64 * 1024,
  streamBufferedBytes: 256 * 1024, globalBufferedBytes: 64 * 1024 * 1024,
  heartbeatMs: 20_000, heartbeatTimeoutMs: 45_000, connectTimeoutMs: 5_000, ticketTtlMs: 10_000,
  responseHeaderTimeoutMs: 30_000, idleTimeoutMs: 300_000 })
export const TUNNEL_PROTOCOL_VERSION = 1 as const
export const TUNNEL_DEVICE_HEADER = "x-synapse-tunnel-device"
export const TUNNEL_KEY_HEADER = "x-synapse-tunnel-key"
export const TUNNEL_CONTROL_PATH = "/api/tunnels/control"
export const TUNNEL_DATA_PATH = "/api/tunnels/data"
export const TUNNEL_RUNTIME_STATUSES = ["connecting", "running", "local-unavailable", "offline", "stopped", "authorization-required", "error"] as const
export type TunnelRuntimeStatus = typeof TUNNEL_RUNTIME_STATUSES[number]
export interface TunnelMappingDto {
  id: string; clientInstanceId: string; deviceName: string; port: number; url: string; enabled: boolean; revision: number
  createdAt: string; updatedAt: string; runtimeStatus: TunnelRuntimeStatus; lastErrorCode: string | null
}
export interface TunnelListInput { offset?: number; limit?: number; clientInstanceId?: string }
export interface TunnelPageDto { items: TunnelMappingDto[]; nextOffset: number | null; total: number }
export interface TunnelCreateInput { port: number; requestId: string }
export interface TunnelUpdateInput { port: number; expectedRevision: number }
export interface TunnelEnableInput { enabled: boolean; expectedRevision: number }
export interface TunnelDeleteInput { expectedRevision: number }
export interface TunnelBindingRef { id: string; revision: number }
export interface TunnelOpenMapping extends TunnelBindingRef { port: number }
type Envelope<T extends string, P = Record<never, never>> = { version: 1; type: T } & P
export type TunnelControlMessage =
  | Envelope<"hello", { clientInstanceId: string; deviceKey: string }>
  | Envelope<"ready", { connectionId: string }>
  | Envelope<"auth-refresh", { token: string }>
  | Envelope<"bindings" | "bindings-ready", { mappings: TunnelBindingRef[] }>
  | Envelope<"open", { requestId: string; ticket: string; mapping: TunnelOpenMapping }>
  | Envelope<"cancel", { requestId: string }>
  | Envelope<"mapping-state", { mappingId: string; revision: number; status: TunnelRuntimeStatus }>
  | Envelope<"data-hello", { requestId: string; ticket: string }>
  | Envelope<"data-ready" | "data-accepted">
  | Envelope<"data-error", { code: string }>

export function isTunnelPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
}
export function isTunnelDomain(domain: string): boolean {
  return domain.length <= 220 && domain === domain.toLowerCase() && domain.includes(".")
    && domain.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))
}
export function createTunnelLabel(randomBytes: (size: number) => Uint8Array = size => globalThis.crypto.getRandomValues(new Uint8Array(size))): string {
  const bytes = randomBytes(16)
  if (bytes.length !== 16) throw new Error("Tunnel label requires 16 random bytes")
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}
export function parseTunnelHost(host: string, domain: string): string | null {
  if (!isTunnelDomain(domain)) return null
  const match = /^([a-f0-9]{32})\.([a-z0-9.-]+)(?::([0-9]{1,5}))?$/iu.exec(host)
  if (!match || match[2]!.toLowerCase() !== domain || (match[3] && !isTunnelPort(Number(match[3])))) return null
  return match[1]!.toLowerCase()
}
export function buildTunnelUrl(label: string, domain: string): string {
  if (!/^[a-f0-9]{32}$/u.test(label) || !isTunnelDomain(domain)) throw new Error("Invalid tunnel address")
  return `https://${label}.${domain}`
}
const text = (v: unknown, max = 128): v is string => typeof v === "string" && v.length > 0 && v.length <= max
const identifier = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_-]+$/u.test(v)
const secret = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/u.test(v)
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k))
function binding(v: unknown): v is TunnelBindingRef {
  return object(v) && keys(v, ["id", "revision"]) && identifier(v.id) && revision(v.revision)
}
/** 不抛出不可信帧内容；握手字节限制还必须在 JSON.parse 前施加。 */
export function parseTunnelControlMessage(value: unknown): TunnelControlMessage | null {
  try {
    if (!object(value) || value.version !== 1 || !text(value.type, 32)
      || new TextEncoder().encode(JSON.stringify(value)).length > TUNNEL_LIMITS.controlFrameBytes) return null
    const exact = (...fields: string[]) => keys(value, ["version", "type", ...fields])
    let valid = false
    switch (value.type) {
      case "hello": valid = exact("clientInstanceId", "deviceKey") && identifier(value.clientInstanceId) && secret(value.deviceKey); break
      case "ready": valid = exact("connectionId") && identifier(value.connectionId); break
      case "auth-refresh": valid = exact("token") && text(value.token, 6144); break
      case "bindings": case "bindings-ready": valid = exact("mappings") && Array.isArray(value.mappings) && value.mappings.length <= TUNNEL_LIMITS.mappingsPerUser && value.mappings.every(binding)
        && new Set(value.mappings.map(v => v.id)).size === value.mappings.length; break
      case "open": valid = exact("requestId", "ticket", "mapping") && identifier(value.requestId) && secret(value.ticket) && object(value.mapping)
        && keys(value.mapping, ["id", "revision", "port"]) && identifier(value.mapping.id) && revision(value.mapping.revision) && isTunnelPort(value.mapping.port); break
      case "cancel": valid = exact("requestId") && identifier(value.requestId); break
      case "mapping-state": valid = exact("mappingId", "revision", "status") && identifier(value.mappingId) && revision(value.revision)
        && TUNNEL_RUNTIME_STATUSES.includes(value.status as TunnelRuntimeStatus); break
      case "data-hello": valid = exact("requestId", "ticket") && identifier(value.requestId) && secret(value.ticket); break
      case "data-ready": case "data-accepted": valid = exact(); break
      case "data-error": valid = exact("code") && text(value.code, 64) && /^[A-Z_]+$/u.test(value.code); break
    }
    return valid ? value as unknown as TunnelControlMessage : null
  } catch { return null }
}
