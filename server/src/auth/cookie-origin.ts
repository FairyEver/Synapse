import { ForbiddenException } from "@nestjs/common"

export function isTrustedCookieOrigin(
  request: { method: string; headers: { origin?: string } },
  publicUrl: string | undefined,
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true
  let expected: string | undefined
  try { expected = publicUrl ? new URL(publicUrl).origin : undefined } catch { expected = undefined }
  return Boolean(expected && request.headers.origin === expected)
}

export function assertCookieOrigin(request: { method: string; headers: { origin?: string } }, publicUrl: string | undefined): void {
  if (!isTrustedCookieOrigin(request, publicUrl)) {
    throw new ForbiddenException({ code: "UNTRUSTED_ORIGIN", message: "请求来源无效" })
  }
}
