import { expect, it, vi } from "vitest"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { MailContextProvider, createMailAccess } from "../context"
it.each(["secret.read", "network.connect", "fs.read.outside-userdata"] as const)("enforces the original MCP caller's %s policy on nested IO", async (action) => {
  const context = new MailContextProvider(() => "server-user"), audit = new InMemoryAuditSink()
  const actor = { kind: "agent" as const, id: "restricted-mcp-client" }
  const guard = { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async (request: { actor: { id?: string } }) => request.actor.id === actor.id ? { allowed: false as const, reason: "caller restricted" } : { allowed: true as const }) }
  const access = createMailAccess(context, guard, audit)
  await expect(access({ ...context.current("mcp"), shareCaller: { actor, source: "mcp-http", clientId: "client-1" } }, action, "mail-resource")).rejects.toMatchObject({ code: "PERMISSION_DENIED" })
  expect(guard.check).toHaveBeenCalledWith(expect.objectContaining({ actor }))
  expect(audit.list()).toEqual([expect.objectContaining({ actor, outcome: "denied" })])
  await expect(access({ ...context.current("sync"), shareCaller: { actor } }, action, "mail-resource")).resolves.toBeUndefined()
  expect(guard.check).toHaveBeenLastCalledWith(expect.objectContaining({ actor: { kind: "system", id: "server-user" } }))
})
it("checks exact local paths without putting filenames or paths in mail audit records", async () => {
  const context = new MailContextProvider(() => "server-user"), audit = new InMemoryAuditSink(), guard = { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }
  const filePath = "/Users/test/Documents/private-recipient-report.pdf"
  await createMailAccess(context, guard, audit)(context.current("ui"), "fs.read.outside-userdata", filePath)
  expect(guard.check).toHaveBeenCalledWith(expect.objectContaining({ resource: filePath }))
  expect(JSON.stringify(audit.list())).not.toContain(filePath)
  expect(JSON.stringify(audit.list())).not.toContain("private-recipient-report")
})
