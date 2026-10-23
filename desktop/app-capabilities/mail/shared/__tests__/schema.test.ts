import { describe, expect, it } from "vitest"
import { MAIL_INPUT_SCHEMAS } from "../schema"
import { MAIL_ACTIONS, MAIL_DEFINITIONS, buildMailTools } from "../capability"

const uuid = "e69940c0-4db1-4a0a-8f87-9027d116e194"
const accountId = `ma_${uuid}`
const messageId = `em_${uuid}`

describe("external mail contracts", () => {
  it("defines 44 unique, strictly validated actions with explicit permission metadata", () => {
    expect(MAIL_ACTIONS).toHaveLength(44)
    expect(new Set(MAIL_ACTIONS).size).toBe(44)
    expect(buildMailTools()).toHaveLength(44)
    for (const action of MAIL_ACTIONS) {
      expect(MAIL_DEFINITIONS[action].permission).toBeTruthy()
      expect(MAIL_INPUT_SCHEMAS[action].safeParse({ ownerId: "fake", credential: "secret" }).success).toBe(false)
    }
  })
  it("refuses old internal mail payloads and requires exact locators", () => {
    expect(MAIL_INPUT_SCHEMAS["message.send"].safeParse({ formatVersion: 3, toIds: ["person"], body: "internal" }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ messageId }).success).toBe(true)
    expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ messageId, reference: `synapse://mail/${messageId}` }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ messageId: "cuid-old" }).success).toBe(false)
  })
  it("bounds batches and pages, and rejects injected headers and invalid endpoints", () => {
    expect(MAIL_INPUT_SCHEMAS["message.update"].safeParse({ accountId, messageIds: Array(101).fill(messageId), patch: { read: true } }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["message.list"].safeParse({ accountId, limit: 101 }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ accountId, to: [{ address: "a@example.com\r\nBcc: b@example.com" }] }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["account.update"].safeParse({ accountId, expectedRevision: 1, patch: { imap: { host: "https://example.com", port: 993, security: "tls" } } }).success).toBe(false)
    expect(MAIL_INPUT_SCHEMAS["account.update"].safeParse({ accountId, expectedRevision: 1, patch: { credential: "secret" } }).success).toBe(false)
  })
  it("does not apply creation defaults to partial edits", () => {
    expect(MAIL_INPUT_SCHEMAS["account.update"].parse({ accountId, expectedRevision: 1, patch: { name: "New name" } }).patch).toEqual({ name: "New name" })
    expect(MAIL_INPUT_SCHEMAS["draft.update"].parse({ draftId: `md_${uuid}`, expectedRevision: 1, patch: { subject: "New subject" } }).patch).toEqual({ subject: "New subject" })
  })
})
