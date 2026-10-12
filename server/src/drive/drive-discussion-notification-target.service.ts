import { Injectable, NotFoundException } from "@nestjs/common"
import { buildDriveDiscussionFragment, type DriveDiscussionOpenResult } from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { DriveService } from "./drive.service"

@Injectable()
export class DriveDiscussionNotificationTargetService {
  constructor(private readonly prisma: PrismaService, private readonly drive: DriveService) {}
  async resolve(userId: string, notificationId: string): Promise<DriveDiscussionOpenResult> {
    const notification = await this.prisma.userNotification.findFirst({
      where: { id: notificationId, userId, deletedAt: null, source: "drive-discussion" },
      include: { driveDiscussionTarget: true },
    })
    const target = notification?.driveDiscussionTarget
    if (!target || target.notificationId !== notificationId) throw new NotFoundException("消息不存在。")
    const browserUrl = await this.drive.getDiscussionBrowserUrl({ userId, itemId: target.itemId, sourceShareId: target.sourceShareId })
    if (!browserUrl) return { status: "unavailable", message: "文档已删除或无法访问" }
    const location = target.kind === "annotation" && target.threadId && target.commentId
      ? { kind: "annotation" as const, threadId: target.threadId, commentId: target.commentId }
      : target.kind === "message" && target.messageId
        ? { kind: "message" as const, messageId: target.messageId, commentId: target.commentId }
        : null
    if (!location) throw new NotFoundException("消息不存在。")
    return { status: "ready", browserUrl: browserUrl + buildDriveDiscussionFragment(location) }
  }
}
