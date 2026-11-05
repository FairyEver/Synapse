import { DatabaseSync } from "node:sqlite"
import { afterEach, expect, it } from "vitest"
import { DataRepositoryImpl } from "../../../runtime/data-repo/repository"
import { SqliteNamespace } from "../../../runtime/data-repo/backends/sqlite"
import { automationMailSchemas } from "../../../runtime/data-repo/schemas/automation-mail-triggers"
import { MailTriggerRepository } from "../repository"

const databases: DatabaseSync[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture() {
  const database = new DatabaseSync(":memory:"); databases.push(database)
  const storage = new DataRepositoryImpl()
  for (const schema of automationMailSchemas) storage.register(schema, new SqliteNamespace({ name: schema.name, schemaVersion: 1, backend: "sqlite", database, validate: schema.validate, sqlite: schema.sqlite }))
  return { storage, database, repo: new MailTriggerRepository(storage) }
}
const identity = { ownerId: "owner", apiOrigin: "https://synapse.test" }
const boundary = { kind: "mail-internal" as const, sourceKey: "internal:owner", receiptSequence: "20", serverTime: "2026-11-05T00:00:00.000Z" }
const receipt = { sourceKey: boundary.sourceKey, receiptKey: "internal:message-21", messageId: "message-21", receivedAt: "2026-11-05T01:00:00.000Z", sequence: "21" }
async function prepare(repo: MailTriggerRepository, automationId = "automation", who = identity) {
  const id = await repo.prepareSubscription({ identity: who, automationId, boundaries: [boundary] })
  const source = (await repo.sourcesFor(id))[0]!
  return { id, source }
}

it("persists a single dispatch claim across repository recreation", async () => {
  const { repo, storage } = fixture(), { id, source } = await prepare(repo)
  const page = { receipts: [receipt], nextCursor: "21", complete: true }
  const outcomes = await Promise.all([repo.enqueuePage(id, source.sourceKey, 0, page), repo.enqueuePage(id, source.sourceKey, 0, page)])
  expect(outcomes.filter(Boolean)).toHaveLength(1)
  const delivery = await repo.nextPending("automation", identity)
  expect(delivery?.receipt.messageId).toBe("message-21")
  expect(await repo.commitDispatch(delivery!.id, 0, "run-1")).toBe(true)
  const reopened = new MailTriggerRepository(storage)
  expect(await reopened.commitDispatch(delivery!.id, 0, "run-2")).toBe(false)
  expect(await reopened.nextPending("automation", identity)).toBeNull()
  const updated = (await reopened.sourcesFor(id))[0]!
  await reopened.enqueuePage(id, source.sourceKey, updated.revision, page)
  expect(await reopened.nextPending("automation", identity)).toBeNull()
})

it("rolls back receipt inserts with a failed cursor update", async () => {
  const { repo, database } = fixture(), { id, source } = await prepare(repo)
  database.exec("CREATE TRIGGER reject_cursor BEFORE UPDATE ON ns_app_automation_mail_sources BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
  await expect(repo.enqueuePage(id, source.sourceKey, 0, { receipts: [receipt], nextCursor: "21", complete: true })).rejects.toThrow("disk failure")
  expect(await repo.nextPending("automation", identity)).toBeNull()
  expect((await repo.sourcesFor(id))[0]?.cursor).toBe("20")
})

it("dedupes across reenable but lets other automations and identities process independently", async () => {
  const { repo, storage } = fixture()
  for (const [automationId, who] of [["automation", identity], ["another", identity], ["automation", { ...identity, ownerId: "other" }], ["automation", { ...identity, apiOrigin: "https://other.test" }]] as const) {
    const { id, source } = await prepare(repo, automationId, who)
    await repo.enqueuePage(id, source.sourceKey, 0, { receipts: [receipt], nextCursor: "21", complete: true })
    expect(await repo.nextPending(automationId, who)).not.toBeNull()
  }
  const first = await repo.nextPending("automation", identity)
  await repo.commitDispatch(first!.id, 0, "run")
  await repo.finishDispatch(first!.id, { state: "success" })
  const again = await prepare(repo)
  await repo.enqueuePage(again.id, again.source.sourceKey, 0, { receipts: [receipt], nextCursor: "21", complete: true })
  expect(await repo.nextPending("automation", identity)).toBeNull()
  expect((await storage.exportAll()).namespaces).toEqual([])
})

it("holds unknown receipt times and rejects mixed-source pages", async () => {
  const { repo } = fixture(), { id, source } = await prepare(repo)
  await repo.enqueuePage(id, source.sourceKey, 0, { receipts: [{ ...receipt, receivedAt: null }], nextCursor: "21", complete: true })
  expect(await repo.nextPending("automation", identity)).toBeNull()
  await expect(repo.enqueuePage(id, source.sourceKey, 1, { receipts: [{ ...receipt, sourceKey: "other" }], nextCursor: "22", complete: true })).rejects.toThrow()
})
