import { expect, it, vi } from "vitest"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { MailContextProvider, createMailAccess } from "../context"
it("checks exact local paths without putting filenames or paths in mail audit records", async () => {
  const context = new MailContextProvider(() => "server-user"), audit = new InMemoryAuditSink(), guard = { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }
  const filePath = "/Users/test/Documents/private-recipient-report.pdf"
  await createMailAccess(context, guard, audit)(context.current("ui"), "fs.read.outside-userdata", filePath)
  expect(guard.check).toHaveBeenCalledWith(expect.objectContaining({ resource: filePath }))
  expect(JSON.stringify(audit.list())).not.toContain(filePath)
  expect(JSON.stringify(audit.list())).not.toContain("private-recipient-report")
})
