import { ForbiddenException } from "@nestjs/common"
export function assertCookieOrigin(request: { method: string; headers: { origin?: string } }, publicUrl: string | undefined): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return
  let expected: string | undefined
  try { expected = publicUrl ? new URL(publicUrl).origin : undefined } catch { expected = undefined }
  if (!expected || request.headers.origin !== expected) throw new ForbiddenException({ code: "UNTRUSTED_ORIGIN", message: "请求来源无效" })
}
