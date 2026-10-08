import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { MailAddress, MailAddressSnapshot } from "../mail/mail-addresses"
import { PrismaService } from "../prisma/prisma.service"
import type { PaginatedResponse, PaginationQuery } from "../common/pagination"

export const adminMailKinds = ["user", "platform_broadcast"] as const
export type AdminMailKind = typeof adminMailKinds[number]

export type AdminMailFilters = {
  readonly search?: string
  readonly kind?: AdminMailKind
  readonly teamId?: string
  readonly from?: string
  readonly to?: string
}

type AdminMailUser = {
  readonly id: string
  readonly email: string
  readonly handle: string
  readonly nickname: string
}

const adminMailUserSelect = {
  id: true,
  email: true,
  handle: true,
  nickname: true,
} as const satisfies Prisma.UserSelect

const adminMailListSelect = {
  id: true,
  senderId: true,
  sender: { select: adminMailUserSelect },
  kind: true,
  teamIdSnapshot: true,
  teamNameSnapshot: true,
  subject: true,
  body: true,
  conversationId: true,
  replyToId: true,
  forwardOfId: true,
  quoteSnapshot: true,
  addressSnapshot: true,
  senderDeletedAt: true,
  sentAt: true,
  _count: { select: { recipients: true, attachments: true } },
} as const satisfies Prisma.MailMessageSelect

const adminMailDetailSelect = {
  ...adminMailListSelect,
  recipients: { select: { readAt: true, deletedAt: true } },
  attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
} as const satisfies Prisma.MailMessageSelect

type AdminMailListRecord = Prisma.MailMessageGetPayload<{ select: typeof adminMailListSelect }>
type AdminMailDetailRecord = Prisma.MailMessageGetPayload<{ select: typeof adminMailDetailSelect }>

export type AdminMailAddress = MailAddress

export type AdminMailMessageSummary = {
  readonly messageId: string
  readonly kind: string
  readonly sender: Omit<AdminMailUser, "id"> & { readonly userId: string } | { readonly userId: "platform"; readonly nickname: "Synapse"; readonly handle: null; readonly email: null }
  readonly toAddresses: AdminMailAddress[]
  readonly ccAddresses: AdminMailAddress[]
  readonly subject: string
  readonly snippet: string
  readonly sentAt: Date
  readonly conversationId: string
  readonly relationKind: "reply" | "forward" | null
  readonly replyToId: string | null
  readonly forwardOfId: string | null
  readonly team: { readonly id: string; readonly name: string } | null
  readonly recipientCount: number
  readonly attachmentCount: number
  readonly senderDeletedAt: Date | null
}

export type AdminMailMessageDetail = AdminMailMessageSummary & {
  readonly body: string
  readonly quote: Prisma.JsonValue | null
  readonly attachments: Array<{
    readonly attachmentId: string
    readonly fileName: string
    readonly mimeType: string | null
    readonly size: number
  }>
  readonly delivery: {
    readonly recipientCount: number
    readonly readCount: number
    readonly deletedCount: number
    readonly pendingCount: number
  }
}

function parseDateBoundary(value: string, boundary: "start" | "end"): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new BadRequestException("日期参数无效。")
    return date
  }
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    throw new BadRequestException("日期参数无效。")
  }
  if (boundary === "end") date.setDate(date.getDate() + 1)
  return date
}

function normalizeSnapshot(value: Prisma.JsonValue | null): MailAddressSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { to: [], cc: [] }
  const record = value as Record<string, unknown>
  return {
    to: normalizeAddresses(record.to),
    cc: normalizeAddresses(record.cc),
  }
}

function normalizeAddresses(value: unknown): MailAddress[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is MailAddress => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const candidate = item as Record<string, unknown>
    return (candidate.kind === "user" && typeof candidate.userId === "string" && typeof candidate.name === "string")
      || (candidate.kind === "organization" && typeof candidate.organizationId === "string" && typeof candidate.name === "string")
      || (candidate.kind === "audience" && typeof candidate.name === "string")
  })
}

function senderOf(sender: AdminMailUser | null) {
  return sender ? { userId: sender.id, nickname: sender.nickname, handle: sender.handle, email: sender.email }
    : { userId: "platform" as const, nickname: "Synapse" as const, handle: null, email: null }
}

function toSummary(row: AdminMailListRecord): AdminMailMessageSummary {
  const snapshot = normalizeSnapshot(row.addressSnapshot)
  return {
    messageId: row.id,
    kind: row.kind,
    sender: senderOf(row.sender),
    toAddresses: snapshot.to,
    ccAddresses: snapshot.cc,
    subject: row.subject,
    snippet: row.body.slice(0, 160),
    sentAt: row.sentAt,
    conversationId: row.conversationId,
    relationKind: row.forwardOfId ? "forward" : row.replyToId ? "reply" : null,
    replyToId: row.replyToId,
    forwardOfId: row.forwardOfId,
    team: row.teamIdSnapshot && row.teamNameSnapshot ? { id: row.teamIdSnapshot, name: row.teamNameSnapshot } : null,
    recipientCount: row._count.recipients,
    attachmentCount: row._count.attachments,
    senderDeletedAt: row.senderDeletedAt,
  }
}

function toDetail(row: AdminMailDetailRecord): AdminMailMessageDetail {
  const summary = toSummary(row)
  const readCount = row.recipients.filter((recipient) => recipient.readAt !== null).length
  const deletedCount = row.recipients.filter((recipient) => recipient.deletedAt !== null).length
  const pendingCount = row.recipients.filter((recipient) => recipient.readAt === null && recipient.deletedAt === null).length
  return {
    ...summary,
    body: row.body,
    replyToId: row.replyToId,
    forwardOfId: row.forwardOfId,
    quote: row.quoteSnapshot,
    attachments: row.attachments.map((attachment) => ({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
    })),
    delivery: {
      recipientCount: row.recipients.length,
      readCount,
      deletedCount,
      pendingCount,
    },
  }
}

@Injectable()
export class AdminMailService {
  constructor(private readonly prisma: PrismaService) {}

  async listMessages(
    pagination: PaginationQuery,
    filters: AdminMailFilters,
  ): Promise<PaginatedResponse<AdminMailMessageSummary>> {
    const where = this.buildWhere(filters)
    const search = filters.search?.trim()
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/gu, "\\$&")}%`
      const matches = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT message.id FROM "MailMessage" AS message
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(message."addressSnapshot"->'to') = 'array'
              THEN message."addressSnapshot"->'to' ELSE '[]'::jsonb END
            || CASE WHEN jsonb_typeof(message."addressSnapshot"->'cc') = 'array'
              THEN message."addressSnapshot"->'cc' ELSE '[]'::jsonb END
          ) AS address
          WHERE address->>'name' ILIKE ${pattern}
        )
      `)
      if (matches.length) (where.OR as Prisma.MailMessageWhereInput[]).push({ id: { in: matches.map((message) => message.id) } })
    }
    const orderBy = [
      { [pagination.sortBy]: pagination.sortOrder },
      { id: pagination.sortOrder },
    ] as Prisma.MailMessageOrderByWithRelationInput[]
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mailMessage.findMany({
        where,
        select: adminMailListSelect,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy,
      }),
      this.prisma.mailMessage.count({ where }),
    ])
    return { data: rows.map(toSummary), total, page: pagination.page, pageSize: pagination.pageSize }
  }

  async getMessage(id: string): Promise<AdminMailMessageDetail> {
    const row = await this.prisma.mailMessage.findUnique({ where: { id }, select: adminMailDetailSelect })
    if (!row) throw new NotFoundException("信件不存在。")
    return toDetail(row)
  }

  async listContext(id: string, cursor?: string): Promise<{ items: AdminMailMessageDetail[]; nextCursor: string | null }> {
    const anchor = await this.prisma.mailMessage.findUnique({ where: { id }, select: { conversationId: true } })
    if (!anchor) throw new NotFoundException("信件不存在。")
    const cursorRow = cursor
      ? await this.prisma.mailMessage.findFirst({ where: { id: cursor, conversationId: anchor.conversationId }, select: { id: true, sentAt: true } })
      : null
    if (cursor && !cursorRow) throw new BadRequestException("无效的分页位置。")
    const rows = await this.prisma.mailMessage.findMany({
      where: {
        conversationId: anchor.conversationId,
        ...(cursorRow ? { OR: [{ sentAt: { lt: cursorRow.sentAt } }, { sentAt: cursorRow.sentAt, id: { lt: cursorRow.id } }] } : {}),
      },
      select: adminMailDetailSelect,
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: 51,
    })
    const page = rows.slice(0, 50).reverse()
    return { items: page.map(toDetail), nextCursor: rows.length > 50 ? rows[49]!.id : null }
  }

  private buildWhere(filters: AdminMailFilters): Prisma.MailMessageWhereInput {
    const search = filters.search?.trim()
    if (search && search.length > 120) throw new BadRequestException("搜索词过长。")
    if (filters.kind && !adminMailKinds.includes(filters.kind)) throw new BadRequestException("消息类型无效。")
    const participantSearch = search ? [
      { email: { contains: search, mode: "insensitive" as const } },
      { handle: { contains: search, mode: "insensitive" as const } },
      { nickname: { contains: search, mode: "insensitive" as const } },
    ] : []
    return {
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.teamId ? { teamIdSnapshot: filters.teamId } : {}),
      ...(filters.from || filters.to ? {
        sentAt: {
          ...(filters.from ? { gte: parseDateBoundary(filters.from, "start") } : {}),
          ...(filters.to ? { lt: parseDateBoundary(filters.to, "end") } : {}),
        },
      } : {}),
      ...(search ? {
        OR: [
          { subject: { contains: search, mode: "insensitive" as const } },
          { body: { contains: search, mode: "insensitive" as const } },
          { sender: { is: { OR: participantSearch } } },
          { recipients: { some: { user: { OR: participantSearch } } } },
        ],
      } : {}),
    }
  }
}
