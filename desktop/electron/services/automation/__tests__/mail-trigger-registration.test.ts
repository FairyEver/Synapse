import { expect, it, vi } from "vitest"
vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: () => undefined, info: () => undefined }) }))
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { engineRig } from "../../automation-mail-triggers/__tests__/engine-fixture"
it("discovers two receipt triggers with body variables and strict filtering scope", () => {
  const registry = createBuiltinAutomationTriggerRegistry()
  const internal = registry.get("builtin.mail-internal-received"), external = registry.get("builtin.mail-received")
  expect(internal.manifest.configSchema.parse({})).toEqual({})
  expect(external.manifest.configSchema.parse({ accountId: "account" })).toEqual({ accountId: "account" })
  expect(external.manifest.configSchema.safeParse({ subject: "filter" }).success).toBe(false)
  expect(internal.activationRequired).toBe(true)
  expect(external.manifest.variables?.some(v => v.key === "trigger.payload.body")).toBe(true)
  expect(external.runtime.shouldAcceptEvent?.({ config: {}, event: { source: "mail-internal", type: "message.received", payload: {}, receivedAt: "2026-11-05T00:00:00Z" } })).toBe(false)
})
it("rejects a manual run without receipt context instead of reading an arbitrary latest letter", async () => {
  const rig = await engineRig()
  try {
    const item = await rig.items.create(rig.input)
    await expect(rig.automation.runNow(item.id)).rejects.toThrow("信件上下文")
    expect(rig.bodies).toEqual([])
  } finally { await rig.close() }
})
