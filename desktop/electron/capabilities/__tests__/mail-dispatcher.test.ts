import { describe, expect, it, vi } from "vitest"
import { buildMailTools } from "../../../synapse-capabilities/shared/mail-domain"
import { createMailCapabilityDispatcher } from "../mail-dispatcher"

describe("mail capability dispatcher", () => {
  it("exposes counts and guarded bulk operations without embedding mail content in audit metadata", async () => {
    const executeMailOperation = vi.fn(async () => ({ deleted: 1, skippedIds: ["hidden"] }))
    const auditSink = { record: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true, reason: "allowed" })) }
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never, auditSink: auditSink as never })
    expect(buildMailTools().find((item) => item.name === "app_mail_message_list")?.inputSchema.properties).toHaveProperty("unreadOnly")
    expect(buildMailTools().find((item) => item.name === "app_mail_message_delete_batch")?.inputSchema.properties?.messageIds).toMatchObject({ minItems: 1, maxItems: 100, uniqueItems: true })
    await dispatcher.dispatch("app.mail.message.delete_batch", { messageIds: ["visible", "hidden"] }, { source: "mcp-http" })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageDeleteBatch", messageIds: ["visible", "hidden"] })
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("visible")
    await expect(dispatcher.dispatch("app.mail.message.delete_batch", { messageIds: ["a", "a"] }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail.message.list", { box: "sent", unreadOnly: true }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail.message.count", { extra: true }, {})).rejects.toThrow()
    const denied = createMailCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: { check: vi.fn(async () => ({ allowed: false, reason: "denied" })) } as never, auditSink: auditSink as never })
    await expect(denied.dispatch("app.mail.message.delete_all", { box: "inbox" }, {})).rejects.toThrow("denied")
    expect(executeMailOperation).toHaveBeenCalledTimes(1)
  })
  it("allows browsing and paging shared-team recipients", async () => {
    const executeMailOperation = vi.fn(async () => ({ items: [], nextCursor: null }))
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation } })
    const tool = buildMailTools().find((entry) => entry.name === "app_mail_recipient_list")
    expect(tool?.inputSchema.properties).toHaveProperty("cursor")

    await expect(dispatcher.dispatch("app.mail.recipient.list", { query: "", cursor: "person-50" }, { source: "api" })).resolves.toMatchObject({ ok: true })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "recipientSearch", query: "", cursor: "person-50" })
  })

  it("reads a copied mail reference through the existing get tool", async () => {
    const executeMailOperation = vi.fn(async () => ({ body: "完整正文" }))
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation } })
    const tool = buildMailTools().find((entry) => entry.name === "app_mail_message_get")
    expect(tool?.inputSchema.properties).toHaveProperty("reference")
    expect(tool?.description).toContain("synapse://mail/<id>")
    await expect(dispatcher.dispatch("app.mail.message.get", { reference: "synapse://mail/mail-1" }, {}))
      .resolves.toMatchObject({ ok: true, data: { body: "完整正文" } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageGet", messageId: "mail-1" })
    await expect(dispatcher.dispatch("app.mail.message.get", { messageId: "mail-1" }, {})).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.mail.message.get", { reference: "synapse:notification:n1" }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail.message.get", { messageId: "mail-1", reference: "synapse://mail/mail-1" }, {})).rejects.toThrow()
    expect(executeMailOperation).toHaveBeenCalledTimes(2)
  })

  it("does not expose retired draft operations", async () => {
    const executeMailOperation = vi.fn()
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation } })
    expect(buildMailTools().map((tool) => tool.name).filter((name) => name.includes("draft"))).toEqual([])
    await expect(dispatcher.dispatch("app.mail.draft.list", {}, { source: "api" })).rejects.toThrow("Unknown mail action")
    expect(executeMailOperation).not.toHaveBeenCalled()
  })

  it("requires the caller's authorization and preview-check declaration before invoking background send", async () => {
    const executeMailOperation = vi.fn(async () => ({ messageId: "message-1" }))
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation } })
    await expect(dispatcher.dispatch("app.mail.message.send", { previewId: "preview-1", clientRequestId: "request-1" }, { source: "api" })).rejects.toThrow()
    expect(executeMailOperation).not.toHaveBeenCalled()

    await expect(dispatcher.dispatch("app.mail.message.send", { previewId: "preview-1", clientRequestId: "request-1", confirmed: true }, { source: "api" }))
      .resolves.toMatchObject({ ok: true, data: { messageId: "message-1" } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "send", previewId: "preview-1", clientRequestId: "request-1" })
  })

  it("checks file write permission before downloading an attachment", async () => {
    const executeMailOperation = vi.fn()
    const permissionGuard = { check: vi.fn(async ({ action }: { action: string }) => ({ allowed: action !== "fs.write.outside-userdata", reason: "denied" })) }
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never })
    await expect(dispatcher.dispatch("app.mail.attachment.download_file", { messageId: "message-1", attachmentId: "attachment-1", outputPath: "/tmp/mail.txt" }, { source: "api" })).rejects.toThrow("denied")
    expect(executeMailOperation).not.toHaveBeenCalled()
  })

  it("uploads local files and rejects Drive attachment parameters", async () => {
    const executeMailOperation = vi.fn(async () => ({ attachmentId: "attachment-1" }))
    const permissionGuard = { check: vi.fn(async ({ action }: { action: string }) => ({ allowed: action !== "fs.read.outside-userdata", reason: "denied" })) }
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never })
    await expect(dispatcher.dispatch("app.mail.attachment.create", { driveItemId: "drive-file" }, { source: "api" })).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail.attachment.create", { filePath: "relative.txt" }, { source: "api" })).rejects.toThrow("absolute")
    await expect(dispatcher.dispatch("app.mail.attachment.create", { filePath: "/tmp/local.txt" }, { source: "api" })).rejects.toThrow("denied")
    expect(executeMailOperation).not.toHaveBeenCalled()
    permissionGuard.check.mockResolvedValue({ allowed: true, reason: "allowed" })
    await expect(dispatcher.dispatch("app.mail.attachment.create", { filePath: "/tmp/local.txt" }, { source: "api" })).resolves.toMatchObject({ ok: true })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "attachmentLocal", filePath: "/tmp/local.txt" })
  })

  it("routes the canonical conversation list action", async () => {
    const executeMailOperation = vi.fn(async () => ({ items: [], nextCursor: null }))
    const dispatcher = createMailCapabilityDispatcher({ accountService: { executeMailOperation } })

    await expect(dispatcher.dispatch("app.mail.context.list", { messageId: "mail-1" }, {}))
      .resolves.toEqual({ ok: true, data: { items: [], nextCursor: null } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageContext", messageId: "mail-1" })
  })
})
