import "reflect-metadata"
import { Test } from "@nestjs/testing"
import type { CanActivate, ExecutionContext } from "@nestjs/common"
import type { NestExpressApplication } from "@nestjs/platform-express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { registerHttpBodyParsers } from "../common/http-body-parser"
import { MailController } from "./mail.controller"
import { MailService } from "./mail.service"

const authenticated: CanActivate = {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().user = { id: "sender" }
    return true
  },
}

async function fixture() {
  const mail = {
    searchRecipients: vi.fn(async () => ({ items: [] })),
    createPreview: vi.fn(async () => ({ previewId: "preview-1", recipients: [], subject: "报告", body: "完整正文", attachments: [] })),
    listContext: vi.fn(async () => ({ items: [], nextCursor: null })),
    listMessages: vi.fn(async () => ({ items: [], nextCursor: null })),
    countMessages: vi.fn(async () => ({ inboxTotal: 0, sentTotal: 0, unread: 0 })),
    readAllMessages: vi.fn(async () => ({ updated: 0 })),
    deleteMessages: vi.fn(async () => ({ deleted: 0, skippedIds: [] })),
    deleteAllMessages: vi.fn(async () => ({ deleted: 0 })),
    send: vi.fn(async () => ({ messageId: "message-1", recipientIds: ["teammate"] })),
    prepareLocalAttachment: vi.fn(async () => ({ attachmentId: "attachment-1" })),
  }
  const moduleRef = await Test.createTestingModule({ controllers: [MailController], providers: [{ provide: MailService, useValue: mail }] })
    .overrideGuard(UserAuthGuard).useValue(authenticated)
    .compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
  registerHttpBodyParsers(app)
  await app.init()
  return { app, mail }
}

describe("internal mail HTTP routes", () => {
  it("routes counts, unread filtering and bulk changes through the authenticated user", async () => {
    const { app, mail } = await fixture()
    try {
      await request(app.getHttpServer()).get("/api/mail/messages?box=inbox&unreadOnly=true").expect(200)
      expect(mail.listMessages).toHaveBeenCalledWith("sender", "inbox", undefined, undefined, true)
      await request(app.getHttpServer()).get("/api/mail/messages?box=sent&unreadOnly=true").expect(400)
      await request(app.getHttpServer()).get("/api/mail/messages/count").expect(200)
      expect(mail.countMessages).toHaveBeenCalledWith("sender")
      await request(app.getHttpServer()).patch("/api/mail/messages/read-all").send({}).expect(200)
      expect(mail.readAllMessages).toHaveBeenCalledWith("sender")
      await request(app.getHttpServer()).post("/api/mail/messages/delete-batch").send({ messageIds: ["a", "b"] }).expect(201)
      expect(mail.deleteMessages).toHaveBeenCalledWith("sender", ["a", "b"])
      await request(app.getHttpServer()).post("/api/mail/messages/delete-batch").send({ messageIds: ["a", "a"] }).expect(400)
      await request(app.getHttpServer()).delete("/api/mail/messages?box=sent").expect(200)
      expect(mail.deleteAllMessages).toHaveBeenCalledWith("sender", "sent")
    } finally { await app.close() }
  })
  it("routes recipient search, fixed preview and send using the authenticated user", async () => {
    const { app, mail } = await fixture()
    try {
      await request(app.getHttpServer()).get("/api/mail/recipients?query=%E7%8E%8B%E6%98%8E").expect(200)
      expect(mail.searchRecipients).toHaveBeenCalledWith("sender", "王明", undefined)

      await request(app.getHttpServer()).get("/api/mail/recipients?query=&cursor=person-49").expect(200)
      expect(mail.searchRecipients).toHaveBeenCalledWith("sender", "", "person-49")

      await request(app.getHttpServer()).post("/api/mail/send-previews")
        .send({ formatVersion: 2, toIds: ["teammate"], ccIds: [], subject: "报告", body: "完整正文", attachmentIds: [], forwardAttachmentIds: [] })
        .expect(201)
      expect(mail.createPreview).toHaveBeenCalledWith("sender", expect.objectContaining({ toIds: ["teammate"], body: "完整正文" }))

      await request(app.getHttpServer()).post("/api/mail/messages")
        .send({ previewId: "preview-1", clientRequestId: "request-1" })
        .expect(201)
      expect(mail.send).toHaveBeenCalledWith("sender", "preview-1", "request-1")
    } finally { await app.close() }
  })

  it("rejects legacy send previews and routes context through the authenticated user", async () => {
    const { app, mail } = await fixture()
    try {
      await request(app.getHttpServer()).post("/api/mail/send-previews")
        .send({ recipientIds: ["teammate"], subject: "旧信", body: "正文", attachmentIds: [] })
        .expect(426)
      expect(mail.createPreview).not.toHaveBeenCalled()
      await request(app.getHttpServer()).get("/api/mail/messages/message-1/context?cursor=older-1").expect(200)
      expect(mail.listContext).toHaveBeenCalledWith("sender", "message-1", "older-1")
    } finally { await app.close() }
  })

  it("streams binary attachment bytes through the production body parser", async () => {
    const { app, mail } = await fixture()
    try {
      await request(app.getHttpServer()).put("/api/mail/attachments/local?fileName=report.txt")
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("report body"))
        .expect(200)
      expect(mail.prepareLocalAttachment).toHaveBeenCalledWith("sender", "report.txt", "application/octet-stream", Buffer.from("report body"))
    } finally { await app.close() }
  })

  it("does not expose Drive file import as a mail attachment route", async () => {
    const { app } = await fixture()
    try {
      await request(app.getHttpServer()).post("/api/mail/attachments/prepare")
        .send({ driveItemId: "drive-file" })
        .expect(404)
    } finally { await app.close() }
  })
})
