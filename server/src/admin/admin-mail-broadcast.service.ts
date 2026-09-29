import { BadRequestException, ConflictException, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { MailService } from "../mail/mail.service"
import { auditActors, AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"

export type BroadcastInput = {
  readonly requestId: string
  readonly subject: string
  readonly body: string
}

@Injectable()
export class AdminMailBroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditLogService,
  ) {}

  async audience(): Promise<{ activeUsers: number }> {
    return { activeUsers: await this.prisma.user.count({ where: { status: "active" } }) }
  }

  async send(input: BroadcastInput, adminSessionId: string, ipAddress: string) {
    const previous = await this.findExisting(input)
    if (previous) return previous

    let result: { messageId: string; recipientCount: number; sentAt: Date }
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({ where: { status: "active" }, select: { id: true }, orderBy: { id: "asc" } })
        if (!users.length) throw new BadRequestException("当前没有可投递的用户。")
        const message = await tx.mailMessage.create({
          data: {
            kind: "platform_broadcast",
            broadcastRequestId: input.requestId,
            subject: input.subject,
            body: input.body,
            conversationId: randomUUID(),
            clientRequestId: input.requestId,
            previewId: randomUUID(),
            addressSnapshot: { to: [{ kind: "audience", name: "全站用户" }], cc: [] },
          },
        })
        for (let index = 0; index < users.length; index += 500) {
          const recipients = users.slice(index, index + 500).map((user) => user.id)
          await tx.mailRecipient.createMany({ data: recipients.map((userId) => ({ messageId: message.id, userId })) })
          await tx.mailNotificationOutbox.createMany({ data: recipients.map((recipientId) => ({ messageId: message.id, recipientId })) })
        }
        await this.audit.recordWithClient(tx, {
          actor: auditActors.platformAdmin(adminSessionId),
          action: "admin.mail.broadcast.send",
          targetType: "mail_message",
          targetId: message.id,
          detail: { requestId: input.requestId, recipientCount: users.length },
          ipAddress,
        })
        return { messageId: message.id, recipientCount: users.length, sentAt: message.sentAt }
      }, { timeout: 120_000 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findExisting(input)
        if (raced) return raced
      }
      throw error
    }
    this.mail.queueNotificationDelivery(result.messageId)
    return result
  }

  private async findExisting(input: BroadcastInput) {
    const existing = await this.prisma.mailMessage.findUnique({
      where: { broadcastRequestId: input.requestId },
      select: { id: true, subject: true, body: true, sentAt: true, _count: { select: { recipients: true } } },
    })
    if (!existing) return null
    if (existing.subject !== input.subject || existing.body !== input.body) {
      throw new ConflictException("请求标识已用于其他公告。")
    }
    this.mail.queueNotificationDelivery(existing.id)
    return { messageId: existing.id, recipientCount: existing._count.recipients, sentAt: existing.sentAt }
  }
}
