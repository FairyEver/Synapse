import { expect, it, vi } from "vitest"
vi.mock("../../log-store", () => ({ createMainLogger: () => ({ warn: () => undefined, info: () => undefined }) }))
import { engineRig } from "./engine-fixture"
import { AutomationMailTriggerLifecycle } from "../lifecycle"
import type { SynapseAccountState } from "../../../../src/types/account"

it("starts in the background and invalidates old contexts before identity changes", async () => {
  const rig = await engineRig()
  rig.detachActivation()
  let before!: () => void | Promise<void>, changed!: () => void
  let state: SynapseAccountState = { status: "authenticated", connectivity: "online", profile: { user: { id: "owner", email: "owner@example.com", status: "active" }, syncedAt: "2026-11-05T00:00:00Z" } }
  const detach = vi.fn(), power = { on: vi.fn(), removeListener: vi.fn() }
  const runtime = new AutomationMailTriggerLifecycle({ repository: rig.repo, items: rig.items, runs: rig.runs, automation: rig.automation,
    sources: new Map([["test.mail", rig.source]]),
    account: { getState: () => state, getApiBaseUrlForLive: () => "https://synapse.test", onBeforeIdentityChange: listener => { before = listener; return detach }, onStateChanged: listener => { changed = () => listener(state); return detach } },
    events: { onType: () => detach }, power, logger: { warn: () => undefined } })
  try {
    await runtime.start()
    const old = runtime.context()
    await before()
    expect(old.signal.aborted).toBe(true)
    state = { ...state, profile: { ...state.profile, user: { ...state.profile.user, id: "other" } } }
    changed()
    expect(runtime.context().identity.ownerId).toBe("other")
    expect(() => runtime.assertCurrent(old)).toThrow()
  } finally { await runtime.stop(); await rig.close() }
  expect(detach).toHaveBeenCalled()
  expect(power.removeListener).toHaveBeenCalledTimes(2)
})
