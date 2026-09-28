import { describe, expect, it } from "vitest"
import { normalizeMailMessage, normalizeMailPage } from "../mail-response"

const person = { userId: "u1", nickname: "李杨", handle: "liyang" }
const oldSummary = {
  messageId: "mail-1", sender: person, recipients: [person], subject: "原信", snippet: "正文",
  sentAt: "2026-09-27T00:00:00.000Z", readAt: null, attachmentCount: 0,
}

describe("mail response compatibility", () => {
  it("shows old server mail without inventing reply or forward history", () => {
    const page = normalizeMailPage({ items: [oldSummary], nextCursor: null })
    expect(page.items[0]).toMatchObject({ toRecipients: [person], ccRecipients: [], relationKind: null })

    const detail = normalizeMailMessage({
      ...oldSummary, viewerId: "u1", body: "正文", team: { id: "team-1", name: "团队" },
      replyToId: "another-mail", attachments: [],
    })
    expect(detail).toMatchObject({ toRecipients: [person], ccRecipients: [], relationKind: null, relation: null, quote: null, legacyFormat: true })
  })

  it("keeps the upgraded server response intact", () => {
    const modern = { ...oldSummary, toRecipients: [person], ccRecipients: [], relationKind: "reply" as const }
    expect(normalizeMailPage({ items: [modern], nextCursor: "mail-1" })).toEqual({ items: [modern], nextCursor: "mail-1" })
  })

  it("does not silently accept a partial or malformed response", () => {
    expect(() => normalizeMailPage({ items: [{ ...oldSummary, recipients: "invalid" }], nextCursor: null })).toThrow()
    expect(normalizeMailPage({ items: [{ ...oldSummary, toRecipients: [person] }], nextCursor: null }).items[0]).not.toHaveProperty("ccRecipients")
  })
})
