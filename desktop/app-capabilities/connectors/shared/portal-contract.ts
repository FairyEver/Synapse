import { z } from "zod"

export const portalStateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const portalIdSchema = z.string().trim().min(1).max(128).refine((value) => !/[\r\n]/.test(value))
export const portalTokenSchema = z.string().min(1).max(16384).refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value))
export const portalCallbackSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), state: portalStateSchema, token: portalTokenSchema, tenantId: portalIdSchema, portalUserId: portalIdSchema }).strict(),
  z.object({ status: z.literal("cancelled"), state: portalStateSchema }).strict(),
  z.object({ status: z.literal("error"), state: portalStateSchema, errorCode: z.enum(["login_failed", "tenant_unavailable", "authorization_failed", "request_expired"]) }).strict(),
])
export type PortalCallback = z.infer<typeof portalCallbackSchema>

export function parsePortalCallback(raw: string, callbackUrl: string): PortalCallback {
  try {
    if (raw.length > 65536 || !raw.startsWith(`${callbackUrl}?`) || /[\u0000-\u0020\u007f]/.test(raw)) throw new Error()
    const url = new URL(raw)
    const target = new URL(callbackUrl)
    if (url.protocol !== target.protocol || url.hostname !== target.hostname || url.pathname !== target.pathname
      || url.username || url.password || url.port || url.hash) throw new Error()
    const values: Record<string, string> = {}
    for (const key of url.searchParams.keys()) {
      if (url.searchParams.getAll(key).length !== 1) throw new Error()
      values[key] = url.searchParams.get(key)!
    }
    return portalCallbackSchema.parse(values)
  } catch {
    // Never propagate URL/Zod input or values to native dialogs and logging.
    throw new Error("Portal 回调无效，请重新连接。")
  }
}
