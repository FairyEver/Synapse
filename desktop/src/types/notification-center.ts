import { z } from "zod"
import type { DriveDiscussionNotificationMetadata } from "@synapse/shared" with { "resolution-mode": "import" }

export type SynapseNotification = {
  readonly driveDiscussion?: DriveDiscussionNotificationMetadata
  readonly mailSubject?: string
  readonly image?: { id: string; mimeType: string; byteSize: number } | null
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

export const notificationSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  body: z.string(),
  group: z.string().nullable(),
  url: z.string().nullable(),
  level: z.enum(["active", "passive", "timeSensitive"]),
  targetId: z.string().nullable(),
  deviceId: z.string().nullable(),
  readAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  image: z.object({ id: z.string(), mimeType: z.string(), byteSize: z.number().int().nonnegative() }).nullable().optional(),
})

export const notificationOpenSchema = notificationSchema.extend({
  copyOnTap: z.boolean().default(false),
}).passthrough()
