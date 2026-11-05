import { afterEach, expect, it } from "vitest"
import { DataRepositoryImpl } from "../../../runtime/data-repo/repository"
import { automationItemsSchema } from "../../../runtime/data-repo/schemas/placeholders"
import { automationMailSchemas } from "../../../runtime/data-repo/schemas/automation-mail-triggers"
import { MailTriggerActivation } from "../activation"
import { sanitizeImportedMailAutomation } from "../transfer"
import { mailTriggerRig } from "./fixtures"
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture() {
  const rig = await mailTriggerRig(); cleanup.push(rig.close)
  const activation = new MailTriggerActivation({ repository: rig.repo, context: rig.context, sourceFor: () => rig.source, listItems: () => rig.items.list() })
  rig.items.attachTriggerLifecycle("test.mail", activation)
  const restored = new DataRepositoryImpl({ importTransforms: { "automation.items": value => sanitizeImportedMailAutomation(value, new Set(["test.mail"])) } })
  restored.register(automationItemsSchema, rig.itemStore)
  for (const schema of automationMailSchemas) restored.register(schema, rig.storage.namespace(schema.name))
  return { ...rig, restored }
}
it("imports a mail automation disabled without clearing local dispatch dedupe", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const source = (await rig.repo.sourcesFor(item.mailSubscription!.id))[0]!
  await rig.repo.enqueuePage(item.mailSubscription!.id, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "letter", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  const row = (await rig.repo.nextPending(item.id, rig.ctx.identity))!
  await rig.repo.commitDispatch(row.id, row.revision, "run")
  const backup = await rig.restored.exportAll()
  expect(backup.namespaces.map(ns => ns.name)).toEqual(["automation.items"])
  await rig.restored.importAll(backup)
  const imported = await rig.items.get(item.id)
  expect(imported?.enabled).toBe(false)
  expect(imported?.mailSubscription).toBeUndefined()
  expect(await rig.repo.commitDispatch(row.id, row.revision, "run-again")).toBe(false)
})
it("rejects local runtime imports before replacing any portable configuration", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const backup = await rig.restored.exportAll()
  const malicious = { ...backup, namespaces: [...backup.namespaces, { name: "app.automation-mail.deliveries", schemaVersion: 1, encrypted: false, data: { items: [] } }] }
  await expect(rig.restored.importAll(malicious)).rejects.toThrow("local-only")
  expect((await rig.items.get(item.id))?.enabled).toBe(true)
})
it("preserves an explicit deletion intent if cleanup fails and resumes it without touching source mail", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const source = (await rig.repo.sourcesFor(item.mailSubscription!.id))[0]!
  await rig.repo.enqueuePage(item.mailSubscription!.id, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  await rig.itemStore.remove(item.id)
  rig.db.exec("CREATE TRIGGER reject_cleanup BEFORE DELETE ON ns_app_automation_mail_deliveries BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
  await expect(rig.repo.deleteAutomationState(item.id)).rejects.toThrow("disk failure")
  expect((await rig.repo.getSubscription(item.mailSubscription!.id))?.errorCode).toBe("DELETE_PENDING")
  rig.db.exec("DROP TRIGGER reject_cleanup")
  await rig.repo.resumeDeletes(rig.ctx.identity)
  expect(await rig.repo.getSubscription(item.mailSubscription!.id)).toBeNull()
})
