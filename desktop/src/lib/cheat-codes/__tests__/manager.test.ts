import { describe, expect, it, vi } from "vitest"

import { createCheatCodeManager, type CheatCodeStateStore } from "@/lib/cheat-codes/manager"
import type { CheatCodeRegistration } from "@/types/cheat-code"

type TestContext = {
  readonly marker: string
}

type TestBinding = {
  readonly sequence: readonly number[]
}

describe("cheat code manager", () => {
  it("runs action cheat codes without touching persistent state", async () => {
    const run = vi.fn()
    const stateStore = createStateStore()
    const manager = createCheatCodeManager<TestContext, TestBinding>({
      registrations: [
        {
          definition: {
            name: "settings:test-action",
            kind: "action",
            run,
          },
          binding: { sequence: [1] },
        },
      ],
      stateStore,
    })

    await expect(manager.trigger("settings:test-action", { marker: "ctx" })).resolves.toEqual({
      changed: true,
      kind: "action",
      name: "settings:test-action",
    })

    expect(run).toHaveBeenCalledWith({ marker: "ctx" })
    expect(stateStore.toggleState).not.toHaveBeenCalled()
  })

  it("toggles state cheat codes and passes the new active state to the callback", async () => {
    const run = vi.fn()
    const stateStore = createStateStore()
    const manager = createCheatCodeManager<TestContext, TestBinding>({
      registrations: [
        {
          definition: {
            name: "settings:test-state",
            kind: "state",
            run,
          },
          binding: { sequence: [2] },
        },
      ],
      stateStore,
    })

    await expect(manager.trigger("settings:test-state", { marker: "ctx" })).resolves.toEqual({
      active: true,
      changed: true,
      kind: "state",
      name: "settings:test-state",
    })
    await expect(manager.trigger("settings:test-state", { marker: "ctx" })).resolves.toEqual({
      active: false,
      changed: true,
      kind: "state",
      name: "settings:test-state",
    })

    expect(run).toHaveBeenNthCalledWith(1, { marker: "ctx" }, { active: true })
    expect(run).toHaveBeenNthCalledWith(2, { marker: "ctx" }, { active: false })
  })

  it("does not run state callbacks when persistence fails", async () => {
    const run = vi.fn()
    const stateStore = createStateStore()
    vi.mocked(stateStore.toggleState).mockRejectedValueOnce(new Error("persist failed"))
    const manager = createCheatCodeManager<TestContext, TestBinding>({
      registrations: [
        {
          definition: {
            name: "settings:test-state",
            kind: "state",
            run,
          },
          binding: { sequence: [2] },
        },
      ],
      stateStore,
    })

    await expect(manager.trigger("settings:test-state", { marker: "ctx" })).rejects.toThrow("persist failed")

    expect(run).not.toHaveBeenCalled()
  })

  it("keeps persisted state when a state callback fails", async () => {
    const run = vi.fn(() => {
      throw new Error("callback failed")
    })
    const stateStore = createStateStore()
    const manager = createCheatCodeManager<TestContext, TestBinding>({
      registrations: [
        {
          definition: {
            name: "settings:test-state",
            kind: "state",
            run,
          },
          binding: { sequence: [2] },
        },
      ],
      stateStore,
    })

    await expect(manager.trigger("settings:test-state", { marker: "ctx" })).rejects.toThrow("callback failed")

    await expect(stateStore.getStates(["settings:test-state"])).resolves.toEqual({
      "settings:test-state": true,
    })
  })

  it("rejects duplicate names, invalid names, and unknown triggers", async () => {
    const first = createRegistration("settings:duplicate", [1])
    const second = createRegistration("settings:duplicate", [2])

    expect(() =>
      createCheatCodeManager<TestContext, TestBinding>({
        registrations: [first, second],
      }),
    ).toThrow("Duplicate cheat code name: settings:duplicate")

    expect(() =>
      createCheatCodeManager<TestContext, TestBinding>({
        registrations: [createRegistration(" ", [1])],
      }),
    ).toThrow("Cheat code name is required.")

    const manager = createCheatCodeManager<TestContext, TestBinding>({
      registrations: [createRegistration("settings:known", [1])],
    })

    await expect(manager.trigger("settings:missing", { marker: "ctx" })).rejects.toThrow(
      "Unknown cheat code: settings:missing",
    )
  })
})

function createRegistration(
  name: string,
  sequence: readonly number[],
): CheatCodeRegistration<TestBinding, TestContext> {
  return {
    definition: {
      name,
      kind: "action",
      run: () => {},
    },
    binding: { sequence },
  }
}

function createStateStore(): CheatCodeStateStore {
  const states = new Map<string, boolean>()

  return {
    getStates: vi.fn(async (names?: readonly string[]) => {
      if (!names) {
        return Object.fromEntries(states)
      }

      return Object.fromEntries(names.map((name) => [name, states.get(name) ?? false]))
    }),
    setState: vi.fn(async ({ name, active }) => {
      states.set(name, active)
      return { active, name }
    }),
    toggleState: vi.fn(async (name: string) => {
      const active = !(states.get(name) ?? false)
      states.set(name, active)
      return { active, name }
    }),
  }
}
