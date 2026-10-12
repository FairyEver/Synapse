import type { DriveDiscussionNotificationMetadata } from "@synapse/shared"
export type DriveDiscussionParticipant = { userId: string; sourceShareId: string | null }
export type DriveDiscussionEvent = DriveDiscussionNotificationMetadata & {
  item: { id: string; userId: string; name: string }
  actor: { userId: string; handle: string }; body: string
  root: { id: string; author: DriveDiscussionParticipant }
  targetCommentId: string | null; directlyRepliedTo: DriveDiscussionParticipant | null
}
export type DriveDiscussionRecipient = DriveDiscussionParticipant & { role: "direct" | "starter" | "owner" }
export type DriveDiscussionDeliveryRef = { userId: string; notificationId: string }
type AuthorRecord = { id: string; createdByUserId: string; sourceShareId?: string | null; createdByUser: { handle: string | null } }
export function makeDriveDiscussionEvent(kind: DriveDiscussionEvent["kind"], action: DriveDiscussionEvent["action"],
  item: DriveDiscussionEvent["item"], root: AuthorRecord, comment: AuthorRecord | null, body: string,
  parent: Pick<AuthorRecord, "createdByUserId" | "sourceShareId"> | null = null): DriveDiscussionEvent {
  const actor = comment ?? root
  const repliedTo = action === "replied" ? parent ?? root : null
  return { kind, action, item, actor: { userId: actor.createdByUserId, handle: actor.createdByUser.handle ?? "用户" },
    body, root: { id: root.id, author: { userId: root.createdByUserId, sourceShareId: root.sourceShareId ?? null } },
    targetCommentId: comment?.id ?? null,
    directlyRepliedTo: repliedTo ? { userId: repliedTo.createdByUserId, sourceShareId: repliedTo.sourceShareId ?? null } : null }
}
