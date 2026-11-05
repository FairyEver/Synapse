import { afterEach, expect, it, vi } from "vitest"
vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: () => undefined, info: () => undefined }) }))
import { engineRig } from "./engine-fixture"
import { AutomationMailTriggerService } from "../service"
import type { MailReceiptRef } from "../types"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function fixture() {
  const rig = await engineRig(); cleanup.push(rig.close)
  const worker = new AutomationMailTriggerService({ repository: rig.repo, activation: rig.activation, context: rig.context, sourceFor: () => rig.source,
    items: rig.items, automation: rig.automation, runs: rig.runs, logger: { warn: () => undefined } })
  cleanup.unshift(() => worker.stop())
  rig.source.scan = async (_ctx, _boundary, cursor) => ({ receipts: [], nextCursor: cursor, complete: true })
  const hydrate = rig.source.hydrate
  rig.source.hydrate = async (ctx, receipt) => ({ ...await hydrate(ctx, { ...receipt, receivedAt: receipt.receivedAt ?? "2026-11-05T01:00:00Z" }), body: receipt.messageId! })
  return { ...rig, worker }
}
const receipt = (sourceKey: string, messageId: string, receivedAt: string | null = "2026-11-05T01:00:00Z"): MailReceiptRef => ({ sourceKey, receiptKey: messageId, messageId, receivedAt, sequence: "21" })

it.each(["closed", "success"] as const)("retires all older source intervals on configuration switch (%s)", async state => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const first = item.mailSubscription!.id
  await rig.repo.enqueuePage(first, "inbox", 0, { receipts: [receipt("inbox", "old-A")], nextCursor: "21", complete: true })
  rig.source.prepare = async (_ctx, accountId) => [{ kind: "mail-internal", sourceKey: accountId ?? "inbox", receiptSequence: "21", serverTime: "2026-11-05T00:00:00Z" }]
  await rig.items.setEnabled(item.id, false)
  await rig.items.setEnabled(item.id, true)
  const old = (await rig.repo.getSubscription(first))!
  await rig.repo.subscriptions.upsert({ ...old, state, revision: old.revision + 1 })
  await rig.items.update(item.id, { trigger: { type: "test.mail", config: { accountId: "B" } } })
  await rig.worker.reconcile("source-switch")
  expect(rig.bodies).toEqual([])
  expect((await rig.repo.getSubscription(first))?.state).toBe("retired")
  expect((await rig.repo.rowsInState(item.id, rig.ctx.identity, "skipped"))).toHaveLength(1)
})

it.each(["current", "historical"] as const)("holds cached deliveries from a stale generation while a healthy source continues (%s)", async period => {
  const rig = await fixture()
  rig.source.prepare = async () => ["stale", "healthy"].map(sourceKey => ({ kind: "mail-internal" as const, sourceKey, receiptSequence: "20", serverTime: "2026-11-05T00:00:00Z" }))
  const item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  for (const key of ["stale", "healthy"]) await rig.repo.enqueuePage(root, key, 0, { receipts: [receipt(key, key)], nextCursor: "21", complete: true })
  if (period === "historical") {
    // Leave one unscanned UID in each closed period, forcing generation validation.
    for (const origin of await rig.repo.sourcesFor(root)) await rig.repo.sources.upsert({ ...origin, cursor: "20", revision: origin.revision + 1 })
    rig.source.prepare = async () => ["stale", "healthy"].map(sourceKey => ({ kind: "mail-internal" as const, sourceKey, receiptSequence: "21", serverTime: "2026-11-05T00:00:00Z" }))
    await rig.items.setEnabled(item.id, false)
    await rig.items.setEnabled(item.id, true)
  }
  rig.source.scan = async (_ctx, boundary, cursor) => { if (boundary.sourceKey === "stale") throw Object.assign(new Error("generation changed"), { code: "STALE_TARGET" }); return { receipts: [], nextCursor: cursor, complete: true } }
  const hydrate = vi.spyOn(rig.source, "hydrate")
  await rig.worker.reconcile("generation-changed")
  expect(rig.bodies).toEqual(["healthy"])
  expect(hydrate.mock.calls.map(call => call[1].sourceKey)).toEqual(["healthy"])
  expect((await rig.repo.nextPending(item.id, rig.ctx.identity))).toBeNull()
  expect((await rig.repo.getSource(root, "stale"))?.state).toBe("blocked")
})

it("does not revive old source intervals after editing the mailbox while disabled", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  await rig.repo.enqueuePage(root, "inbox", 0, { receipts: [receipt("inbox", "old-A")], nextCursor: "21", complete: true })
  rig.source.prepare = async (_ctx, accountId) => [{ kind: "mail-internal", sourceKey: accountId ?? "inbox", receiptSequence: "21", serverTime: "2026-11-05T00:00:00Z" }]
  await rig.items.setEnabled(item.id, false)
  await rig.items.update(item.id, { trigger: { type: "test.mail", config: { accountId: "B" } } })
  await rig.items.setEnabled(item.id, true)
  await rig.worker.reconcile("edited-while-disabled")
  expect(rig.bodies).toEqual([])
  expect((await rig.repo.getSubscription(root))?.state).toBe("retired")
})

it("uses the committed configuration generation even if retirement cleanup was interrupted", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  await rig.repo.enqueuePage(root, "inbox", 0, { receipts: [receipt("inbox", "old-A")], nextCursor: "21", complete: true })
  rig.source.prepare = async () => [{ kind: "mail-internal", sourceKey: "inbox", receiptSequence: "21", serverTime: "2026-11-05T00:00:00Z" }]
  await rig.items.setEnabled(item.id, false)
  await rig.items.setEnabled(item.id, true)
  const old = (await rig.repo.getSubscription(root))!
  await rig.repo.subscriptions.upsert({ ...old, state: "success", revision: old.revision + 1 })
  vi.spyOn(rig.repo, "retireGeneration").mockRejectedValueOnce(new Error("cleanup interrupted"))
  await rig.items.update(item.id, { trigger: { type: "test.mail", config: { accountId: "B" } } })
  vi.spyOn(rig.activation, "recoverBindings").mockResolvedValue()
  await rig.worker.reconcile("cleanup-pending")
  expect(rig.bodies).toEqual([])
  expect(await rig.repo.rowsInState(item.id, rig.ctx.identity, "skipped")).toHaveLength(1)
})

it("finishes an undated permanently inaccessible receipt and continues metadata recovery", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  await rig.repo.enqueuePage(root, "inbox", 0, { receipts: [receipt("inbox", "a-deleted", null), receipt("inbox", "b-readable", null)], nextCursor: "22", complete: true })
  const hydrate = rig.source.hydrate
  rig.source.hydrate = async (ctx, ref) => { if (ref.messageId === "a-deleted") throw Object.assign(new Error("gone"), { code: "UNAVAILABLE" }); return hydrate(ctx, ref) }
  await rig.worker.reconcile("metadata")
  expect(rig.bodies).toEqual(["b-readable"])
  expect(await rig.repo.rowsInState(item.id, rig.ctx.identity, "awaiting_metadata")).toEqual([])
  expect(await rig.repo.rowsInState(item.id, rig.ctx.identity, "failed")).toMatchObject([{ errorCode: "UNAVAILABLE", runId: expect.any(String) }])
})

it("preserves a confirmed stopping watermark when an older scan fails late", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  const entered = deferred(), release = deferred()
  rig.source.scan = async () => { entered.resolve(); await release.promise; throw new Error("late network failure") }
  const scan = rig.worker.reconcile("slow-scan")
  await entered.promise
  rig.source.prepare = async () => [{ kind: "mail-internal", sourceKey: "inbox", receiptSequence: "21", serverTime: "2026-11-05T00:00:00Z" }]
  await rig.items.setEnabled(item.id, false)
  release.resolve(); await scan
  expect((await rig.repo.getSource(root, "inbox"))?.endCursor).toBe("21")
})

it("does not execute if disable commits before the durable claim and retains the unstarted letter", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true }), root = item.mailSubscription!.id
  await rig.repo.enqueuePage(root, "inbox", 0, { receipts: [receipt("inbox", "queued")], nextCursor: "21", complete: true })
  const entered = deferred(), release = deferred(), original = rig.automation.runDurableEvent.bind(rig.automation)
  rig.automation.runDurableEvent = input => original({ ...input, commitStart: async () => { entered.resolve(); await release.promise; return input.commitStart() } })
  const dispatch = rig.worker.reconcile("dispatch")
  await entered.promise
  await rig.items.setEnabled(item.id, false)
  release.resolve(); await dispatch
  expect(rig.bodies).toEqual([])
  expect((await rig.repo.nextPending(item.id, rig.ctx.identity))?.receipt.messageId).toBe("queued")
})
