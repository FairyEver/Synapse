import { afterEach, expect, it, vi } from "vitest"
vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: () => undefined, info: () => undefined }) }))
import { engineRig } from "./engine-fixture"
import { AutomationMailTriggerService } from "../service"
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture() {
  const rig = await engineRig(); cleanup.push(rig.close)
  const worker = new AutomationMailTriggerService({ repository: rig.repo, activation: rig.activation, context: rig.context, sourceFor: () => rig.source,
    items: rig.items, automation: rig.automation, runs: rig.runs, logger: { warn: () => undefined } })
  cleanup.unshift(() => worker.stop())
  return { ...rig, worker }
}
it("backfills enabled receipts once and never redispatches after history pruning", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  rig.source.scan = async (_ctx, boundary, cursor) => ({ receipts: [{ sourceKey: boundary.sourceKey, receiptKey: "receipt-21", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z", sequence: "21" }], nextCursor: "21", complete: true })
  await rig.worker.reconcile("test")
  await rig.worker.reconcile("duplicate")
  expect(rig.bodies).toEqual(["body"])
  for (let i = 0; i < 101; i++) { const run = await rig.runs.start(item.id, "manual", { triggerType: item.trigger.type, executorType: item.executor.type }); await rig.runs.finish(run.id, { status: "success" }) }
  await rig.worker.reconcile("after prune")
  expect(rig.bodies).toEqual(["body"])
})
it("retains a busy delivery without consuming its dispatch claim", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const root = item.mailSubscription!.id, source = (await rig.repo.sourcesFor(root))[0]!
  await rig.repo.enqueuePage(root, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "one", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  const original = rig.automation.runDurableEvent.bind(rig.automation)
  rig.automation.runDurableEvent = async () => ({ kind: "busy" })
  await rig.worker.reconcile("busy")
  expect(await rig.repo.nextPending(item.id, rig.ctx.identity)).not.toBeNull()
  rig.automation.runDurableEvent = original
  await rig.worker.reconcile("available")
  expect(rig.bodies).toEqual(["body"])
})
it("recovers an ambiguous committed dispatch without invoking the executor", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const root = item.mailSubscription!.id, source = (await rig.repo.sourcesFor(root))[0]!
  await rig.repo.enqueuePage(root, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "one", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  const row = (await rig.repo.nextPending(item.id, rig.ctx.identity))!
  await rig.repo.commitDispatch(row.id, row.revision, "reserved-run")
  await rig.worker.reconcile("restart")
  expect(rig.bodies).toEqual([])
  expect((await rig.runs.get("reserved-run"))?.error).toContain("未自动重试")
  await rig.worker.reconcile("again")
  expect(rig.bodies).toEqual([])
})
