import { expect, it, vi } from "vitest"
import { createMailCapabilityDispatcher } from "../dispatcher"
import { MAIL_ACTIONS, MAIL_DEFINITIONS, buildMailTools } from "../../shared/capability"
import { MailContextProvider } from "../context"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
it("shares the service and rejects injected identities, credentials and internal mail payloads", async () => {
  const context = new MailContextProvider(() => "server-user"), execute = vi.fn(async () => ({ items: [], nextCursor: null }))
  const dispatcher = createMailCapabilityDispatcher({ service: { context: actor => context.current(actor), execute: execute as unknown as import("../service").MailService["execute"] }, permissionGuard: { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }, auditSink: new InMemoryAuditSink() })
  expect(await dispatcher.dispatch("app.mail.account.list", {}, { source: "mcp-http" })).toMatchObject({ ok: true, data: { externalData: true, value: { items: [] } } })
  expect(execute).toHaveBeenCalledTimes(1)
  for (const input of [{ ownerId: "forged" }, { credential: "secret" }]) expect(await dispatcher.dispatch("app.mail.account.list", input, { source: "mcp-http" })).toMatchObject({ ok: false, code: "INVALID_INPUT" })
  expect(await dispatcher.dispatch("app.mail.account.configure", { credential: "secret" }, {})).toMatchObject({ ok: false, code: "UNKNOWN_ACTION" })
  expect(await dispatcher.dispatch("app.mail.message.send", { formatVersion: 3, toIds: ["internal"], body: "internal" }, {})).toMatchObject({ ok: false, code: "INVALID_INPUT" })
  expect(execute).toHaveBeenCalledTimes(1)
})
it("aligns all 44 schema/actions/tools with permissions and pagination descriptions", () => {
  const tools = buildMailTools()
  expect(tools).toHaveLength(44)
  for (const action of MAIL_ACTIONS) expect(MAIL_DEFINITIONS[action].permission).toBeTruthy()
  for (const name of ["account_list", "folder_list", "message_list", "search_get", "draft_list", "attachment_list", "operation_list"]) expect(tools.find(t => t.name === `app_mail_${name}`)?.description).toContain("Pagination: cursor-based.")
  expect(tools.some(t => t.name.includes("configure"))).toBe(false)
})
