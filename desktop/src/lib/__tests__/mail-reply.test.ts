import { describe, expect, it } from "vitest"
import { canQuickReplyToMail, createMailQuickReplyContent, mailReplyRecipients } from "../mail-reply"
import type { MailMessage } from "@/types/mail"

const reader = { userId: "reader", nickname: "阅读者", handle: "reader" }
const writer = { userId: "writer", nickname: "发件人", handle: "writer" }
const observer = { userId: "observer", nickname: "观察者", handle: "observer" }

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    messageId: "message-1",
    sender: writer,
    recipients: [reader],
    toRecipients: [reader],
    ccRecipients: [],
    relationKind: null,
    subject: "项目进展",
    snippet: "正文",
    sentAt: "2026-10-22T00:00:00.000Z",
    readAt: null,
    attachmentCount: 0,
    viewerId: "reader",
    body: "正文",
    team: { id: "team-1", name: "团队" },
    conversationId: "conversation-1",
    replyToId: null,
    relation: null,
    quote: null,
    attachments: [],
    ...overrides,
  }
}

describe("mail reply helpers", () => {
  it("replies to the sender for received mail", () => {
    expect(mailReplyRecipients(message(), "reader")).toEqual({ toIds: ["writer"], toOrganizationIds: [] })
  })

  it("replies to the original To recipients for sent mail using the existing reply rule", () => {
    expect(mailReplyRecipients(message({
      sender: reader,
      toRecipients: [reader, writer, observer, writer],
    }), "reader")).toEqual({ toIds: ["reader", "writer", "observer"], toOrganizationIds: [] })
  })

  it("keeps the viewer for self mail", () => {
    expect(mailReplyRecipients(message({ sender: reader, toRecipients: [reader] }), "reader")).toEqual({ toIds: ["reader"], toOrganizationIds: [] })
  })

  it("keeps the original organization addresses for sent mail", () => {
    expect(mailReplyRecipients(message({
      sender: reader,
      toRecipients: [],
      toAddresses: [
        { kind: "user", userId: "writer", name: "发件人" },
        { kind: "organization", organizationId: "org-1", name: "研发部" },
        { kind: "user", userId: "observer", name: "观察者" },
        { kind: "user", userId: "writer", name: "发件人" },
      ],
    }), "reader")).toEqual({ toIds: ["writer", "observer"], toOrganizationIds: ["org-1"] })
  })

  it("builds a text-only reply in the source conversation", () => {
    expect(createMailQuickReplyContent(message(), "收到")).toEqual({
      formatVersion: 3,
      toIds: ["writer"],
      ccIds: [],
      toOrganizationIds: [],
      ccOrganizationIds: [],
      subject: "回复：项目进展",
      body: "收到",
      attachmentIds: [],
      forwardAttachmentIds: [],
      relation: { kind: "reply", messageId: "message-1" },
    })
    expect(canQuickReplyToMail(message())).toBe(true)
    expect(canQuickReplyToMail(message({ kind: "platform_broadcast" }))).toBe(false)
  })
})
