import { describe, expect, it, vi } from "vitest"
import { buildMailInternalTools } from "../../../synapse-capabilities/shared/mail-internal-domain"
import { createMailInternalCapabilityDispatcher } from "../mail-internal-dispatcher"

describe("mail capability dispatcher", () => {
  it("exposes historical contacts and validates person filters for each mailbox", async () => {
    const executeMailOperation = vi.fn(async () => ({ items: [], nextCursor: null }))
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })
    const tools = buildMailInternalTools()
    expect(tools.find(tool => tool.name === "app_mail_internal_contact_list")).toBeDefined()
    expect(tools.find(tool => tool.name === "app_mail_internal_message_list")?.inputSchema.properties).toHaveProperty("contactKey")
    await dispatcher.dispatch("app.mail_internal.contact.list", { box: "sent" }, {})
    expect(executeMailOperation).toHaveBeenLastCalledWith({ kind: "contactList", box: "sent" })
    await dispatcher.dispatch("app.mail_internal.message.list", { box: "sent", contactKey: "organization:team", cursor: "older" }, {})
    expect(executeMailOperation).toHaveBeenLastCalledWith({ kind: "messageList", box: "sent", contactKey: "organization:team", cursor: "older" })
    for (const input of [{ box: "sent", contactKey: "platform" }, { box: "inbox", contactKey: "organization:team" }, { box: "inbox", contactKey: "user:" }]) {
      await expect(dispatcher.dispatch("app.mail_internal.message.list", input, {})).rejects.toThrow()
    }
    await expect(dispatcher.dispatch("app.mail_internal.contact.list", { box: "inbox", query: "restricted" }, {})).rejects.toThrow()
    expect(executeMailOperation).toHaveBeenCalledTimes(2)
  })

  it("exposes counts and guarded bulk operations without embedding mail content in audit metadata", async () => {
    const executeMailOperation = vi.fn(async () => ({ deleted: 1, skippedIds: ["hidden"] }))
    const auditSink = { record: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true, reason: "allowed" })) }
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never, auditSink: auditSink as never })
    expect(buildMailInternalTools().find((item) => item.name === "app_mail_internal_message_list")?.inputSchema.properties).toHaveProperty("unreadOnly")
    expect(buildMailInternalTools().find((item) => item.name === "app_mail_internal_message_delete_batch")?.inputSchema.properties?.messageIds).toMatchObject({ minItems: 1, maxItems: 100, uniqueItems: true })
    await dispatcher.dispatch("app.mail_internal.message.delete_batch", { messageIds: ["visible", "hidden"] }, { source: "mcp-http" })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageDeleteBatch", messageIds: ["visible", "hidden"] })
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("visible")
    await expect(dispatcher.dispatch("app.mail_internal.message.delete_batch", { messageIds: ["a", "a"] }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail_internal.message.list", { box: "sent", unreadOnly: true }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail_internal.message.count", { extra: true }, {})).rejects.toThrow()
    const denied = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: { check: vi.fn(async () => ({ allowed: false, reason: "denied" })) } as never, auditSink: auditSink as never })
    await expect(denied.dispatch("app.mail_internal.message.delete_all", { box: "inbox" }, {})).rejects.toThrow("denied")
    expect(executeMailOperation).toHaveBeenCalledTimes(1)
  })
  it("allows browsing and paging shared-team recipients", async () => {
    const executeMailOperation = vi.fn(async () => ({ items: [], nextCursor: null }))
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })
    const tool = buildMailInternalTools().find((entry) => entry.name === "app_mail_internal_recipient_list")
    expect(tool?.inputSchema.properties).toHaveProperty("cursor")

    await expect(dispatcher.dispatch("app.mail_internal.recipient.list", { query: "", cursor: "person-50" }, { source: "api" })).resolves.toMatchObject({ ok: true })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "recipientSearch", query: "", cursor: "person-50" })
  })

  it("reads a copied mail reference through the existing get tool", async () => {
    const executeMailOperation = vi.fn(async () => ({ body: "完整正文" }))
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })
    const tool = buildMailInternalTools().find((entry) => entry.name === "app_mail_internal_message_get")
    expect(tool?.inputSchema.properties).toHaveProperty("reference")
    expect(tool?.description).toContain("synapse://mail-internal/<id>")
    await expect(dispatcher.dispatch("app.mail_internal.message.get", { reference: "synapse://mail-internal/mail-1" }, {}))
      .resolves.toMatchObject({ ok: true, data: { body: "完整正文" } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageGet", messageId: "mail-1" })
    await expect(dispatcher.dispatch("app.mail_internal.message.get", { messageId: "mail-1" }, {})).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.mail_internal.message.get", { reference: "synapse:notification:n1" }, {})).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail_internal.message.get", { messageId: "mail-1", reference: "synapse://mail-internal/mail-1" }, {})).rejects.toThrow()
    expect(executeMailOperation).toHaveBeenCalledTimes(2)
  })

  it("does not expose retired draft operations", async () => {
    const executeMailOperation = vi.fn()
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })
    expect(buildMailInternalTools().map((tool) => tool.name).filter((name) => name.includes("draft"))).toEqual([])
    await expect(dispatcher.dispatch("app.mail_internal.draft.list", {}, { source: "api" })).rejects.toThrow("Unknown mail action")
    expect(executeMailOperation).not.toHaveBeenCalled()
  })

  it("requires the caller's authorization and preview-check declaration before invoking background send", async () => {
    const executeMailOperation = vi.fn(async () => ({ messageId: "message-1" }))
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })
    await expect(dispatcher.dispatch("app.mail_internal.message.send", { previewId: "preview-1", clientRequestId: "request-1" }, { source: "api" })).rejects.toThrow()
    expect(executeMailOperation).not.toHaveBeenCalled()

    await expect(dispatcher.dispatch("app.mail_internal.message.send", { previewId: "preview-1", clientRequestId: "request-1", confirmed: true }, { source: "api" }))
      .resolves.toMatchObject({ ok: true, data: { messageId: "message-1" } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "send", previewId: "preview-1", clientRequestId: "request-1" })
  })

  it("checks file write permission before downloading an attachment", async () => {
    const executeMailOperation = vi.fn()
    const permissionGuard = { check: vi.fn(async ({ action }: { action: string }) => ({ allowed: action !== "fs.write.outside-userdata", reason: "denied" })) }
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never })
    await expect(dispatcher.dispatch("app.mail_internal.attachment.download_file", { messageId: "message-1", attachmentId: "attachment-1", outputPath: "/tmp/mail.txt" }, { source: "api" })).rejects.toThrow("denied")
    expect(executeMailOperation).not.toHaveBeenCalled()
  })

  it("uploads local files and rejects Drive attachment parameters", async () => {
    const executeMailOperation = vi.fn(async () => ({ attachmentId: "attachment-1" }))
    const permissionGuard = { check: vi.fn(async ({ action }: { action: string }) => ({ allowed: action !== "fs.read.outside-userdata", reason: "denied" })) }
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation }, permissionGuard: permissionGuard as never })
    await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { driveItemId: "drive-file" }, { source: "api" })).rejects.toThrow()
    await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { filePath: "relative.txt" }, { source: "api" })).rejects.toThrow("absolute")
    await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { filePath: "/tmp/local.txt" }, { source: "api" })).rejects.toThrow("denied")
    expect(executeMailOperation).not.toHaveBeenCalled()
    permissionGuard.check.mockResolvedValue({ allowed: true, reason: "allowed" })
    await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { filePath: "/tmp/local.txt" }, { source: "api" })).resolves.toMatchObject({ ok: true })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "attachmentLocal", filePath: "/tmp/local.txt" })
  })

  it("routes the canonical conversation list action", async () => {
    const executeMailOperation = vi.fn(async () => ({ items: [], nextCursor: null }))
    const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation } })

    await expect(dispatcher.dispatch("app.mail_internal.context.list", { messageId: "mail-1" }, {}))
      .resolves.toEqual({ ok: true, data: { items: [], nextCursor: null } })
    expect(executeMailOperation).toHaveBeenCalledWith({ kind: "messageContext", messageId: "mail-1" })
  })
})

it("imports a share reference with the original caller and rejects ambiguous sources and oversized PNGs", async () => {
  const executeMailOperation = vi.fn(), uploadMailAttachment = vi.fn(async () => ({ attachmentToken: "token" }))
  const resolveShareImage = vi.fn(async () => ({ bytes: Buffer.from("png"), fileName: "share.png", mimeType: "image/png" as const }))
  const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation, uploadMailAttachment }, resolveShareImage })
  const context = { actor: { kind: "agent" as const, id: "origin" } }
  const shareImageRef = "ca8ce19e-ec42-4d08-90c9-19a887a89805"
  await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { shareImageRef }, context)).resolves.toMatchObject({ ok: true })
  expect(resolveShareImage).toHaveBeenCalledWith(shareImageRef, context)
  expect(uploadMailAttachment).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png" }), undefined)
  await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { shareImageRef, filePath: "/tmp/a" }, context)).rejects.toThrow()
  resolveShareImage.mockResolvedValueOnce({ bytes: Buffer.alloc(20 * 1024 * 1024 + 1), fileName: "large.png", mimeType: "image/png" })
  await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { shareImageRef }, context)).rejects.toThrow("20")
  expect(uploadMailAttachment).toHaveBeenCalledTimes(1)
  expect(executeMailOperation).not.toHaveBeenCalled()
})

it("does not upload when cancellation happens during share image resolution", async () => {
  const controller = new AbortController(), uploadMailAttachment = vi.fn()
  const dispatcher = createMailInternalCapabilityDispatcher({ accountService: { executeMailOperation: vi.fn(), uploadMailAttachment }, resolveShareImage: async () => { controller.abort(); return { bytes: Buffer.from("png"), fileName: "share.png", mimeType: "image/png" } } })
  await expect(dispatcher.dispatch("app.mail_internal.attachment.create", { shareImageRef: "ca8ce19e-ec42-4d08-90c9-19a887a89805" }, { abortSignal: controller.signal })).rejects.toThrow()
  expect(uploadMailAttachment).not.toHaveBeenCalled()
})
