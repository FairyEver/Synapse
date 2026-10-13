import type { DriveDiscussionNotificationMetadata } from "@synapse/shared"
export type DriveDiscussionParticipant = { userId: string; sourceShareId: string | null }
export type DriveDiscussionEvent = DriveDiscussionNotificationMetadata & {
  item: { id: string; userId: string; name: string }
  actor: { userId: string; handle: string }; body: string
  root: { id: string; author: DriveDiscussionParticipant }
  targetCommentId: string | null; directlyRepliedTo: DriveDiscussionParticipant | null
  original?: { kind: "text" | "image"; text: string }
  replyTo?: { authorName: string; content: string }
}
export type DriveDiscussionRecipient = DriveDiscussionParticipant & { role: "direct" | "starter" | "owner" }
export type DriveDiscussionDeliveryRef = { userId: string; notificationId: string }
type AuthorRecord = { id: string; createdByUserId: string; sourceShareId?: string | null; createdByUser: { handle: string | null }; body?: string }
type RootRecord = AuthorRecord & {
  anchor?: { selectors: unknown } | null; target?: unknown
  comments?: readonly (AuthorRecord & { parentCommentId?: string | null; deletedAt?: Date | null })[]
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}
function originalExcerpt(root: RootRecord): DriveDiscussionEvent["original"] {
  const selectors = record(root.anchor?.selectors)
  const target = record(root.target)
  if (selectors.kind === "image" || target.kind === "image") {
    const snapshot = record(target.snapshot)
    const text = typeof snapshot.alt === "string" && snapshot.alt.trim() ? snapshot.alt
      : typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title : "文档中的图片"
    return { kind: "image", text }
  }
  const quote = record(selectors.quote ?? target.quote)
  return typeof quote.exact === "string" && quote.exact ? { kind: "text", text: quote.exact } : undefined
}
export function makeDriveDiscussionEvent(kind: DriveDiscussionEvent["kind"], action: DriveDiscussionEvent["action"],
  item: DriveDiscussionEvent["item"], root: RootRecord, comment: AuthorRecord | null, body: string,
  parent: AuthorRecord | null = null): DriveDiscussionEvent {
  const actor = comment ?? root
  const repliedTo = action === "replied" ? parent ?? root : null
  const replyContent = action === "replied" ? parent ?? (kind === "message" ? root : root.comments?.find((c) => !c.parentCommentId && !c.deletedAt)) : null
  return { kind, action, item, actor: { userId: actor.createdByUserId, handle: actor.createdByUser.handle ?? "用户" },
    ...(kind === "annotation" ? { original: originalExcerpt(root) } : {}),
    ...(replyContent?.body !== undefined ? { replyTo: { authorName: replyContent.createdByUser.handle ?? "用户", content: replyContent.body } } : {}),
    body, root: { id: root.id, author: { userId: root.createdByUserId, sourceShareId: root.sourceShareId ?? null } },
    targetCommentId: comment?.id ?? null,
    directlyRepliedTo: repliedTo ? { userId: repliedTo.createdByUserId, sourceShareId: repliedTo.sourceShareId ?? null } : null }
}
