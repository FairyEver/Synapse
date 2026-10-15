import type { DriveDiscussionNotificationMetadata } from "@synapse/shared" with { "resolution-mode": "import" }

export type SynapseNotification = {
  readonly driveDiscussion?: DriveDiscussionNotificationMetadata
  readonly id: string
  readonly source: string
  readonly title: string
  readonly body: string
  readonly group: string | null
  readonly url: string | null
  readonly copyOnTap: boolean
  readonly level: "active" | "passive" | "timeSensitive"
  readonly targetId: string | null
  readonly deviceId: string | null
  readonly readAt: string | null
  readonly resolvedAt: string | null
  readonly createdAt: string
}

export type NotificationPage = {
  readonly items: SynapseNotification[]
  readonly nextCursor: string | null
}
