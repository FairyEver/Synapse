/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  WORKFLOW_ENTRY_TITLE_SEQUENCE,
  type CheatCodeContext,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"
import {
  findMatchingCheatCode,
  trimTitleSequenceBuffer,
  useCheatCodeTitleSequence,
} from "@/modules/settings/hooks/use-cheat-code-title-sequence"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import type { CheatCodeStateStore } from "@/lib/cheat-codes/manager"
import type { CheatCodeTriggerResult } from "@/types/cheat-code"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let latestApi: ReturnType<typeof useCheatCodeTitleSequence> | null = null

beforeEach(() => {
  vi.useFakeTimers()
  latestApi = null
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  latestApi = null
  vi.useRealTimers()
})

describe("useCheatCodeTitleSequence", () => {
  it("matches registered cheat codes by sequence suffix", () => {
    const registration = createRegistration("settings:test", [0, 11, 8, 9])

    expect(findMatchingCheatCode([registration], [4, 0, 11, 8, 9])?.definition.name).toBe("settings:test")
    expect(findMatchingCheatCode([registration], [0, 0, 8, 9])).toBeNull()
  })

  it("trims buffers to the maximum registered sequence length", () => {
    expect(trimTitleSequenceBuffer([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
    expect(trimTitleSequenceBuffer([1, 2], 4)).toEqual([1, 2])
    expect(trimTitleSequenceBuffer([1, 2], 0)).toEqual([])
  })

  it("arms title sequence entry after ten logo clicks", () => {
    renderProbe()

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(latestApi?.isArmed).toBe(true)
  })

  it("resets logo click count after the shared timeout before arming", () => {
    renderProbe()

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD - 1)
    advanceSharedTimeout()
    clickLogoTimes(1)

    expect(latestApi?.isArmed).toBe(false)
  })

  it("exits armed mode after the shared timeout with no title input", () => {
    renderProbe()

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    expect(latestApi?.isArmed).toBe(true)

    advanceSharedTimeout()

    expect(latestApi?.isArmed).toBe(false)
  })

  it("ignores title clicks before arming", async () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    await clickTitleSequence([0, 11, 8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
  })

  it("runs a matched cheat code and exits armed mode", async () => {
    const enableRepositoryMaintenance = vi.fn()
    const onTriggered = vi.fn()

    renderProbe({
      context: { enableRepositoryMaintenance },
      onTriggered,
    })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence([0, 11, 8, 9])

    expect(onTriggered).toHaveBeenCalledWith({
      changed: true,
      kind: "action",
      name: "settings:repository-maintenance:enable",
    })
    expect(enableRepositoryMaintenance).toHaveBeenCalledTimes(1)
    expect(latestApi?.isArmed).toBe(false)
  })

  it("toggles state cheat codes through the persistent state store", async () => {
    const stateStore = createStateStore()
    const onTriggered = vi.fn()

    renderProbe({
      cheatCodes: [createStateRegistration(WORKFLOW_ENTRY_CHEAT_CODE_NAME, WORKFLOW_ENTRY_TITLE_SEQUENCE)],
      onTriggered,
      stateStore,
    })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence(WORKFLOW_ENTRY_TITLE_SEQUENCE)

    expect(stateStore.toggleState).toHaveBeenCalledWith(WORKFLOW_ENTRY_CHEAT_CODE_NAME)
    expect(onTriggered).toHaveBeenCalledWith({
      active: true,
      changed: true,
      kind: "state",
      name: WORKFLOW_ENTRY_CHEAT_CODE_NAME,
    })
    expect(latestApi?.isArmed).toBe(false)
  })

  it("does not collapse repeated characters with different indexes", async () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence([0, 0, 8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
    expect(latestApi?.isArmed).toBe(true)
  })

  it("clears partial input and exits armed mode after the shared timeout", async () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence([0, 11])
    advanceSharedTimeout()
    await clickTitleSequence([8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
    expect(latestApi?.isArmed).toBe(false)
  })
})

function renderProbe(props: {
  readonly cheatCodes?: readonly CheatCodeRegistration[]
  readonly context?: CheatCodeContext
  readonly onTriggered?: (result: CheatCodeTriggerResult) => void
  readonly stateStore?: CheatCodeStateStore
} = {}): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(
      <Probe
        cheatCodes={props.cheatCodes ?? [
          createRegistration("settings:repository-maintenance:enable", [0, 11, 8, 9]),
        ]}
        context={props.context ?? { enableRepositoryMaintenance: vi.fn() }}
        onTriggered={props.onTriggered}
        stateStore={props.stateStore}
      />,
    )
  })
}

function Probe(props: {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (result: CheatCodeTriggerResult) => void
  readonly stateStore?: CheatCodeStateStore
}) {
  latestApi = useCheatCodeTitleSequence(props)
  return null
}

function clickLogoTimes(count: number): void {
  for (let index = 0; index < count; index += 1) {
    act(() => {
      if (!latestApi) throw new Error("Probe not rendered")
      latestApi.handleLogoClick()
    })
  }
}

async function clickTitleSequence(sequence: readonly number[]): Promise<void> {
  for (const index of sequence) {
    await act(async () => {
      if (!latestApi) throw new Error("Probe not rendered")
      latestApi.handleTitleIndexClick(index)
      await Promise.resolve()
    })
  }
}

function advanceSharedTimeout(): void {
  act(() => {
    vi.advanceTimersByTime(CHEAT_CODE_INTERACTION_RESET_DELAY)
  })
}

function createRegistration(name: string, settingsTitleSequence: readonly number[]): CheatCodeRegistration {
  return {
    definition: {
      name,
      kind: "action",
      run: ({ enableRepositoryMaintenance }) => {
        enableRepositoryMaintenance()
      },
    },
    binding: {
      settingsTitleSequence,
    },
  }
}

function createStateRegistration(name: string, settingsTitleSequence: readonly number[]): CheatCodeRegistration {
  return {
    definition: {
      name,
      kind: "state",
      run: () => undefined,
    },
    binding: {
      settingsTitleSequence,
    },
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
