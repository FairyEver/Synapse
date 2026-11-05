import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import type { PrismaService } from "../prisma/prisma.service"

const sequence = z.string().regex(/^(0|[1-9]\d{0,18})$/u).refine(value => BigInt(value) <= 9223372036854775807n)
const query = z.object({ after: sequence, through: sequence.optional(), limit: z.number().int().min(1).max(50).default(50) }).strict()
type ChangesQuery = { after: string; through?: string; limit?: number }

/** Allocating a receipt sequence and confirming a boundary share the transaction fence. */
export async function withMailReceiptFence(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '5s', true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1398361665, 1296124236)`
}
export class MailReceiptFeed {
  constructor(private readonly prisma: PrismaService) {}
  async checkpoint(userId: string): Promise<{ receiptSequence: string; serverTime: string }> {
    return this.prisma.$transaction(async tx => {
      await withMailReceiptFence(tx)
      const max = await tx.mailRecipient.aggregate({ where: { userId }, _max: { deliverySequence: true } })
      const [clock] = await tx.$queryRaw<{ serverTime: Date }[]>`SELECT clock_timestamp() AS "serverTime"`
      return { receiptSequence: String(max._max.deliverySequence ?? 0n), serverTime: clock!.serverTime.toISOString() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 })
  }
  async changes(userId: string, input: ChangesQuery) {
    const parsed = query.safeParse(input)
    if (!parsed.success) throw new BadRequestException("无效的收信游标或分页范围。")
    const { after, limit } = parsed.data
    const through = parsed.data.through ?? (await this.checkpoint(userId)).receiptSequence
    if (BigInt(after) > BigInt(through)) throw new BadRequestException("收信游标超出范围。")
    const rows = await this.prisma.mailRecipient.findMany({ where: { userId, deletedAt: null, deliverySequence: { gt: BigInt(after), lte: BigInt(through) } },
      orderBy: { deliverySequence: "asc" }, take: limit + 1, select: { deliverySequence: true, messageId: true, message: { select: { sentAt: true } } } })
    const items = rows.slice(0, limit).map(row => ({ messageId: row.messageId, receiptSequence: String(row.deliverySequence), sentAt: row.message.sentAt.toISOString() }))
    const complete = rows.length <= limit
    return { items, nextAfter: complete ? through : items.at(-1)!.receiptSequence, through, complete }
  }
}
