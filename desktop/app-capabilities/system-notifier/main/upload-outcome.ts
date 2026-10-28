import type { NotificationImageUploadOutcome } from "../shared/schema"

/**
 * 把上传接口的一次响应折叠成调用方能处理的结果。401/403 到不了这里 ——
 * `fetchAuthenticated` 会先刷新重试一次，仍失败才抛错。
 */
export function mapNotificationImageUploadResponse(
  status: number,
  body: unknown,
): NotificationImageUploadOutcome {
  if (status >= 200 && status < 300) {
    const imageId = typeof body === "object" && body !== null ? (body as { imageId?: unknown }).imageId : undefined
    return typeof imageId === "string" ? { status: "uploaded", imageId } : { status: "failed" }
  }
  if (status === 401 || status === 403) return { status: "not_signed_in" }
  // 429 是服务端每个账号的待认领图片配额，不是坏请求：这次先只发正文，稍后自然会恢复。
  if (status === 429) return { status: "failed" }
  // 404/405 说明服务端还没有这个路由，其余 4xx 说明它不接受这个版本的请求体：
  // 对调用方是同一件事 —— 需要更新服务端，重试没有意义。
  if (status >= 400 && status < 500) return { status: "service_outdated" }
  return { status: "failed" }
}
