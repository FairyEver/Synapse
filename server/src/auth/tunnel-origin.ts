import { ForbiddenException } from "@nestjs/common"
export function assertTunnelCookieOrigin(request: { method: string; headers: { origin?: string } }, publicUrl: string | undefined, enabled: boolean): void {
  if (!enabled || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return
  let expected: string | undefined
  try { expected = publicUrl ? new URL(publicUrl).origin : undefined } catch { expected = undefined }
  if (!expected || request.headers.origin !== expected) throw new ForbiddenException({ code: "UNTRUSTED_ORIGIN", message: "请求来源无效" })
}
