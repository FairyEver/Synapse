import { afterEach, expect, it } from "vitest"
import { MailTriggerActivation } from "../activation"
import { mailTriggerRig } from "./fixtures"
import { automationItemsSchema } from "../../../runtime/data-repo/schemas/placeholders"
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture() {
  const rig = await mailTriggerRig(); cleanup.push(rig.close)
  const activation = new MailTriggerActivation({ repository: rig.repo, context: rig.context, sourceFor: () => rig.source, listItems: () => rig.items.list() })
  rig.items.attachTriggerLifecycle("test.mail", activation)
  return { ...rig, activation }
}
it("keeps activation disabled when the live origin cannot be confirmed", async () => {
  const rig = await fixture(), item = await rig.items.create(rig.input)
  rig.source.prepare = async () => { throw new Error("offline") }
  await expect(rig.items.setEnabled(item.id, true)).rejects.toThrow("offline")
  expect((await rig.items.get(item.id))?.enabled).toBe(false)
})
it("rejects malformed private subscription references in persisted items", async () => {
  const rig = await fixture(), item = await rig.items.create(rig.input)
  expect(automationItemsSchema.validate({ ...item, mailSubscription: { id: 42 } })).toBe(false)
})
it("does not activate an unreferenced prepared subscription after restart", async () => {
  const rig = await fixture(), item = await rig.items.create(rig.input)
  await rig.activation.prepare(rig.ctx, item)
  await rig.activation.recoverBindings()
  expect((await rig.items.get(item.id))?.enabled).toBe(false)
  const enabled = await rig.items.setEnabled(item.id, true)
  expect(enabled.enabled).toBe(true)
  expect((await rig.repo.getSubscription(enabled.mailSubscription!.id))?.state).toBe("ready")
})
it("keeps the prior configuration when a source change cannot prepare and keeps the origin on executor edits", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const edited = await rig.items.update(item.id, { name: "renamed" })
  expect(edited.mailSubscription?.id).toBe(item.mailSubscription?.id)
  rig.source.prepare = async () => { throw new Error("missing account") }
  await expect(rig.items.update(item.id, { trigger: { type: "test.mail", config: { accountId: "missing" } } })).rejects.toThrow()
  expect((await rig.items.get(item.id))?.trigger.config).toEqual({})
  expect((await rig.items.get(item.id))?.mailSubscription?.id).toBe(item.mailSubscription?.id)
})
it("closes an enabled period on disable and never lets a new identity take it over", async () => {
  const rig = await fixture(), item = await rig.items.create({ ...rig.input, enabled: true })
  const stopped = await rig.items.setEnabled(item.id, false)
  expect(stopped.mailSubscription?.stoppedAt).toEqual(expect.any(String))
  expect((await rig.repo.getSubscription(item.mailSubscription!.id))?.state).toBe("closed")
  rig.setContext({ ...rig.ctx, generation: 2, identity: { ...rig.ctx.identity, ownerId: "other" } })
  await expect(rig.items.setEnabled(item.id, true)).rejects.toThrow("身份")
})
