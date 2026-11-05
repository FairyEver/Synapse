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
  const item = await rig.items.create({ ...rig.input, enabled: true })
  rig.source.scan = async (_ctx, boundary) => ({ receipts: [{ sourceKey: boundary.sourceKey, receiptKey: "one", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  return { ...rig, worker, item }
}
it("records an unknown result after the dispatch marker commits but creating its run fails", async () => {
  const rig = await fixture()
  vi.spyOn(rig.runs, "start").mockRejectedValueOnce(new Error("injected run write failure"))
  await rig.worker.reconcile("lost run write")
  const row = (await rig.repo.rowsInState(rig.item.id, rig.ctx.identity, "unknown"))[0]
  expect(row).toBeDefined()
  expect((await rig.runs.get(row!.runId!))?.error).toContain("未自动重试")
  await rig.worker.reconcile("restart")
  expect(rig.bodies).toEqual([])
})
it("retains preparation failures before dispatch and processes them after the connection recovers", async () => {
  const rig = await fixture(), hydrate = rig.source.hydrate
  rig.source.hydrate = async () => { throw new Error("offline") }
  await rig.worker.reconcile("offline")
  expect(rig.bodies).toEqual([])
  const pending = (await rig.repo.rowsInState(rig.item.id, rig.ctx.identity, "pending"))[0]!
  await rig.repo.deferDelivery(pending, 0, "RETRY")
  rig.source.hydrate = hydrate
  await rig.worker.reconcile("reconnected")
  expect(rig.bodies).toEqual(["body"])
})
it("does not invoke an executor for a permanent unavailable body", async () => {
  const rig = await fixture()
  rig.source.hydrate = async () => { throw Object.assign(new Error("removed"), { code: "UNAVAILABLE" }) }
  await rig.worker.reconcile("removed")
  expect(rig.bodies).toEqual([])
  expect((await rig.runs.listByAutomation(rig.item.id))[0]?.status).toBe("failed")
  await rig.worker.reconcile("duplicate")
  expect(rig.bodies).toEqual([])
})
it("labels a committed run as unknown after generic startup recovery has already finished it", async () => {
  const rig = await fixture(), source = (await rig.repo.sourcesFor(rig.item.mailSubscription!.id))[0]!
  await rig.repo.enqueuePage(rig.item.mailSubscription!.id, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "one", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  const row = (await rig.repo.nextPending(rig.item.id, rig.ctx.identity))!
  await rig.repo.commitDispatch(row.id, row.revision, "lost-run")
  await rig.runs.start(rig.item.id, "trigger", { triggerType: rig.item.trigger.type, executorType: rig.item.executor.type, reservedRunId: "lost-run" })
  await rig.automation.start()
  await rig.worker.reconcile("startup")
  expect((await rig.runs.get("lost-run"))?.error).toContain("未自动重试")
  expect(rig.bodies).toEqual([])
  await rig.automation.stop()
})

it("counts startup recovery before mail activation attaches, then counts the next letter once", async () => {
  const rig = await fixture(), source = (await rig.repo.sourcesFor(rig.item.mailSubscription!.id))[0]!
  await rig.repo.enqueuePage(rig.item.mailSubscription!.id, source.sourceKey, 0, { receipts: [{ sourceKey: source.sourceKey, receiptKey: "one", messageId: "letter", receivedAt: "2026-11-05T01:00:00Z" }], nextCursor: "21", complete: true })
  const row = (await rig.repo.nextPending(rig.item.id, rig.ctx.identity))!
  await rig.repo.commitDispatch(row.id, row.revision, "interrupted-before-mail-start")
  await rig.runs.start(rig.item.id, "trigger", { triggerType: rig.item.trigger.type, executorType: rig.item.executor.type, reservedRunId: "interrupted-before-mail-start" })
  rig.detachActivation()
  await rig.automation.start()
  expect(await rig.items.get(rig.item.id)).toMatchObject({ enabled: true, runCount: 1, lastStatus: "failed", mailSubscription: rig.item.mailSubscription, configVersion: rig.item.configVersion })
  await expect(rig.items.setEnabled(rig.item.id, true)).rejects.toThrow("收信触发服务尚未就绪")
  const detach = rig.automation.attachTriggerLifecycle("test.mail", rig.activation)
  try {
    await rig.worker.reconcile("mail starts after automation")
    expect((await rig.items.get(rig.item.id))?.runCount).toBe(1)
    expect((await rig.runs.get("interrupted-before-mail-start"))?.error).toContain("未自动重试")
    expect(rig.bodies).toEqual([])
    rig.source.scan = async (_ctx, boundary) => ({ receipts: [{ sourceKey: boundary.sourceKey, receiptKey: "two", messageId: "next-letter", receivedAt: "2026-11-05T02:00:00Z" }], nextCursor: "22", complete: true })
    await rig.worker.reconcile("next letter")
    await rig.worker.reconcile("duplicate")
    expect(rig.bodies).toEqual(["body"])
    expect((await rig.items.get(rig.item.id))?.runCount).toBe(2)
  } finally { detach(); await rig.automation.stop() }
})

it("does not invoke the executor if identity expires while previous outputs are loading", async () => {
  const rig = await fixture(), controller = new AbortController()
  rig.setContext({ ...rig.ctx, signal: controller.signal })
  const list = rig.runs.listByAutomation.bind(rig.runs)
  vi.spyOn(rig.runs, "listByAutomation").mockImplementation(async (id, options) => { controller.abort(); return list(id, options) })
  await expect(rig.worker.reconcile("identity expiry")).rejects.toThrow()
  expect(rig.bodies).toEqual([])
})
