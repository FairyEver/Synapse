import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, expect, it } from "vitest"
import { MailReceiptFeed, withMailReceiptFence } from "../src/mail/mail-receipt-feed"

let prisma: PrismaClient, owner: string
const messages: string[] = []
beforeAll(async () => {
  const { requireMailTriggerTestDatabase } = await import("./mail-triggers-e2e-database-guard.mjs")
  requireMailTriggerTestDatabase(process.env.MAIL_TRIGGERS_E2E_DATABASE_URL)
  prisma = new PrismaClient({ datasources: { db: { url: process.env.MAIL_TRIGGERS_E2E_DATABASE_URL! } } })
  const suffix = randomUUID()
  owner = (await prisma.user.create({ data: { email: `${suffix}@mail.invalid`, handle: suffix, passwordHash: "test-only" } })).id
})
afterAll(async () => {
  if (!prisma) return
  await prisma.mailMessage.deleteMany({ where: { id: { in: messages } } })
  if (owner) await prisma.user.delete({ where: { id: owner } })
  await prisma.$disconnect()
})
it("a checkpoint waits for committed receipts and later commits remain visible", async () => {
  let locked!: () => void, release!: () => void
  const ready = new Promise<void>(r => { locked = r }), gate = new Promise<void>(r => { release = r })
  const write = prisma.$transaction(async tx => {
    await withMailReceiptFence(tx)
    const id = randomUUID(); messages.push(id)
    await tx.mailMessage.create({ data: { id, subject: "fixture", body: "body", conversationId: id, clientRequestId: id, previewId: id, recipients: { create: { userId: owner } } } })
    locked(); await gate
    return id
  })
  await ready
  const feed = new MailReceiptFeed(prisma as never)
  const boundaryPromise = feed.checkpoint(owner)
  release(); await write
  const boundary = await boundaryPromise
  expect((await feed.changes(owner, { after: boundary.receiptSequence })).items).toEqual([])
  const later = await prisma.$transaction(async tx => {
    await withMailReceiptFence(tx)
    const id = randomUUID(); messages.push(id)
    return tx.mailMessage.create({ data: { id, subject: "late", body: "body", sentAt: new Date("2000-01-01T00:00:00Z"), conversationId: id, clientRequestId: id, previewId: id, recipients: { create: { userId: owner } } } })
  })
  expect((await feed.changes(owner, { after: boundary.receiptSequence })).items.map(x => x.messageId)).toEqual([later.id])
})
