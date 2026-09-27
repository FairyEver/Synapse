import { describe, expect, it, vi } from "vitest"
import { createMailCapabilityDispatcher } from "../mail-dispatcher"

describe("mail capability dispatcher", () => {
  it("requires the explicit confirmation flag before invoking background send", async () => {
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
})
