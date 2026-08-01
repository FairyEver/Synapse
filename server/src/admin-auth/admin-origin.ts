import { ForbiddenException } from "@nestjs/common"
import type { Request } from "express"

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function assertTrustedAdminOrigin(request: Pick<Request, "method" | "get">): void {
  if (!unsafeMethods.has(request.method)) return
  const configuredUrl = process.env.APP_PUBLIC_URL
  const origin = request.get("origin")
  if (!configuredUrl || !origin || origin !== new URL(configuredUrl).origin) {
    throw new ForbiddenException("请求来源无效。")
  }
}
