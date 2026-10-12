import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { NotificationService } from "../src/notifications/notification.service"
import { DriveDiscussionNotificationService } from "../src/drive/drive-discussion-notification.service"
import { DriveMessageService } from "../src/drive/drive-message.service"
import { DriveService } from "../src/drive/drive.service"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

export async function discussionFixture() {
  const database = requireLoopbackE2eDatabase(process.env.DRIVE_DISCUSSION_E2E_DATABASE_URL, "DRIVE_DISCUSSION_E2E_DATABASE_URL")
  const prisma = new PrismaClient({ datasources: { db: { url: database } } })
  const suffix = randomUUID()
  const users: string[] = []
  const cleanup = async () => {
    if (users.length) {
      await prisma.driveMessageComment.deleteMany({ where: { message: { item: { userId: { in: users } } } } })
      await prisma.driveItem.deleteMany({ where: { userId: { in: users } } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
    await prisma.$disconnect()
  }
  try {
    for (const role of ["owner", "reader", "third"]) {
      users.push((await prisma.user.create({ data: { email: `${suffix}-${role}@drive-discussion.invalid`, handle: `${suffix}-${role}`, nickname: "验收", passwordHash: "test-only" } })).id)
    }
    const item = await prisma.driveItem.create({ data: { userId: users[0]!, name: "验收.md", type: "file", mimeType: "text/markdown", storageStatus: "active", uploadStatus: "completed", storageKey: suffix } })
    const notifications = new NotificationService(prisma as never, { broadcastToUser: () => ({ failedClientCount: 0 }) } as never, { sendToMobileClients: () => undefined } as never, { sendNotification: async () => ({ sent: 0, failed: 0, skipped: false }) } as never, {} as never)
    const discussion = new DriveDiscussionNotificationService(prisma as never, notifications)
    const share = await prisma.driveShare.create({ data: { userId: users[0]!, itemId: item.id, shareId: randomUUID(), type: item.type, enabled: true, accessMode: "link_read" } })
    const drive = Object.create(DriveService.prototype) as DriveService
    Object.assign(drive, { prisma, accessSecret: "e2e-only-secret" })
    const messages = new DriveMessageService(prisma as never, drive, discussion)
    return { prisma, users, owner: users[0]!, reader: users[1]!, third: users[2]!, item, share, notifications, discussion, messages, access: { kind: "share" as const, shareId: share.shareId, itemId: item.id }, cleanup }
  } catch (error) { await cleanup(); throw error }
}
export function discussionLatch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
