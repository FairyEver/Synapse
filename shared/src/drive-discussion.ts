export type DriveDiscussionNotificationSnapshot = {
  readonly detailTitle: string
  readonly content: string
  readonly original?: { readonly kind: "text" | "image"; readonly text: string }
  readonly replyTo?: { readonly authorName: string; readonly content: string }
}
export type DriveDiscussionNotificationMetadata = {
  readonly kind: "annotation" | "message"
  readonly action: "created" | "replied"
  readonly snapshot?: DriveDiscussionNotificationSnapshot
}

/** Project only display fields; internal discussion/share context must never escape. */
export function parseDriveDiscussionNotificationSnapshot(value: unknown): DriveDiscussionNotificationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined
  const input = value as Record<string, unknown>
  const bounded = (text: unknown, limit: number): text is string => typeof text === "string" && Array.from(text).length <= limit
  if (!bounded(input.detailTitle, 2048) || !input.detailTitle || !bounded(input.content, 500)) return undefined
  const result: { detailTitle: string; content: string; original?: DriveDiscussionNotificationSnapshot["original"]; replyTo?: DriveDiscussionNotificationSnapshot["replyTo"] } = {
    detailTitle: input.detailTitle, content: input.content,
  }
  if (input.original && typeof input.original === "object") {
    const original = input.original as Record<string, unknown>
    if ((original.kind === "text" || original.kind === "image") && bounded(original.text, 200) && original.text) {
      result.original = { kind: original.kind, text: original.text }
    }
  }
  if (input.replyTo && typeof input.replyTo === "object") {
    const reply = input.replyTo as Record<string, unknown>
    if (bounded(reply.authorName, 200) && bounded(reply.content, 200)) result.replyTo = { authorName: reply.authorName, content: reply.content }
  }
  return result
}
export type DriveDiscussionNotificationDto = {
  readonly id: string; readonly source: string; readonly url: string | null
  readonly readAt: string | null; readonly driveDiscussion?: DriveDiscussionNotificationMetadata
}
export type DriveDiscussionLocation =
  | { readonly kind: "annotation"; readonly threadId: string; readonly commentId: string }
  | { readonly kind: "message"; readonly messageId: string; readonly commentId: string | null }
export type DriveDiscussionOpenResult =
  | { readonly status: "ready"; readonly browserUrl: string }
  | { readonly status: "unavailable"; readonly message: "文档已删除或无法访问" }

const idPattern = /^[A-Za-z0-9_-]{1,120}$/u
export function isDriveDiscussionNotificationOpenPath(pathname: string): boolean {
  const parts = pathname.split("/")
  return parts.length === 4 && parts[0] === "" && parts[1] === "notifications" && idPattern.test(parts[2] ?? "") && parts[3] === "open"
}
export function buildDriveDiscussionNotificationOpenUrl(origin: string, notificationId: string): string {
  const url = new URL(origin)
  const loopbackHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if ((url.protocol !== "https:" && !loopbackHttp) || url.username || url.password || !idPattern.test(notificationId)) throw new Error("Invalid discussion notification URL")
  return new URL("/notifications/" + notificationId + "/open", url.origin).toString()
}
export function buildDriveDiscussionFragment(location: DriveDiscussionLocation): string {
  const params = new URLSearchParams({ discussion: location.kind })
  if (location.kind === "annotation") {
    params.set("threadId", location.threadId)
    params.set("commentId", location.commentId)
  } else {
    params.set("messageId", location.messageId)
    if (location.commentId !== null) params.set("commentId", location.commentId)
  }
  const hash = "#" + params.toString()
  if (!parseDriveDiscussionFragment(hash)) throw new Error("Invalid discussion location")
  return hash
}
export function parseDriveDiscussionFragment(hash: string): DriveDiscussionLocation | null {
  if (!hash.startsWith("#") || hash.length > 500) return null
  const params = new URLSearchParams(hash.slice(1))
  for (const key of params.keys()) if (params.getAll(key).length !== 1) return null
  const kind = params.get("discussion")
  const commentId = params.get("commentId")
  if (kind === "annotation") {
    const threadId = params.get("threadId")
    if (params.size !== 3 || !threadId || !commentId || !idPattern.test(threadId) || !idPattern.test(commentId)) return null
    return { kind, threadId, commentId }
  }
  if (kind === "message") {
    const messageId = params.get("messageId")
    if (params.size !== (commentId === null ? 2 : 3) || params.has("threadId") || !messageId || !idPattern.test(messageId) || (commentId !== null && !idPattern.test(commentId))) return null
    return { kind, messageId, commentId }
  }
  return null
}
export function getDriveDiscussionActionLabel(meta?: DriveDiscussionNotificationMetadata | null): "查看评论" | "查看留言" | "查看回复" | "查看文档" {
  if (!meta || (meta.kind !== "annotation" && meta.kind !== "message")) return "查看文档"
  if (meta.action === "replied") return "查看回复"
  if (meta.action !== "created") return "查看文档"
  return meta.kind === "annotation" ? "查看评论" : "查看留言"
}
