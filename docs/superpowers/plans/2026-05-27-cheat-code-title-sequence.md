# Cheat Code Title Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings-local cheat code system where ten About-page logo clicks arm an enlarged, color-cycling title sequence input, then the registered title index sequence opens repository maintenance.

**Architecture:** `cheat-codes.ts` owns stable cheat code names, the shared ten-second interaction timeout, the title input binding, active title color classes, callbacks, and registry validation. `use-cheat-code-title-sequence.ts` owns logo click arming, armed-state tracking, index buffering, shared-timeout reset, suffix matching, and callback dispatch. `AboutPanel` renders the existing logo/title, supplies the action context, and applies the temporary `text-4xl` plus Tailwind default text color feedback while armed.

**Tech Stack:** Electron renderer, React 19, TypeScript, Vitest, jsdom, shadcn/Radix/Tailwind existing UI baseline.

---

## File Structure

- Create `desktop/src/modules/settings/cheat-codes.ts`: settings-local cheat code registry, shared constants, title parts, active title color classes, validation helpers, and callback types.
- Create `desktop/src/modules/settings/__tests__/cheat-codes.test.ts`: pure unit tests for constants, title parts, registry contents, callbacks, color classes, and validation failures.
- Create `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`: hook and pure helpers for arming, sequence matching, buffer trimming, and reset.
- Create `desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx`: hook tests for logo arming, timeout reset, matching, wrong repeated character index, and callback dispatch.
- Create `desktop/src/modules/settings/components/__tests__/about-panel.test.tsx`: About panel integration tests for logo-armed UI, title index clicks, timeouts, and non-triggering logo clicks.
- Modify `desktop/src/modules/settings/components/about-panel.tsx`: repurpose logo clicks to arm entry; wire title spans to the hook; apply temporary size and color feedback.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note under `## 功能优化`.

## Task 1: Cheat Code Registry

**Files:**
- Create: `desktop/src/modules/settings/__tests__/cheat-codes.test.ts`
- Create: `desktop/src/modules/settings/cheat-codes.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `desktop/src/modules/settings/__tests__/cheat-codes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES,
  SETTINGS_CHEAT_CODE_TITLE,
  buildSettingsTitleParts,
  getSettingsTitleActiveColorClass,
  settingsCheatCodes,
  settingsTitleParts,
  validateCheatCodeRegistrations,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"

describe("settings cheat codes", () => {
  it("defines shared interaction constants in one place", () => {
    expect(CHEAT_CODE_INTERACTION_RESET_DELAY).toBe(10000)
    expect(CHEAT_CODE_LOGO_CLICK_THRESHOLD).toBe(10)
  })

  it("builds stable title parts with duplicate characters separated by index", () => {
    expect(SETTINGS_CHEAT_CODE_TITLE).toBe("Synapse AI Studio")

    expect(settingsTitleParts[0]).toEqual({ index: 0, char: "S", clickable: true })
    expect(settingsTitleParts[7]).toEqual({ index: 7, char: " ", clickable: false })
    expect(settingsTitleParts[11]).toEqual({ index: 11, char: "S", clickable: true })
    expect(settingsTitleParts[16]).toEqual({ index: 16, char: "o", clickable: true })
  })

  it("can build title parts for validation tests", () => {
    expect(buildSettingsTitleParts("A B")).toEqual([
      { index: 0, char: "A", clickable: true },
      { index: 1, char: " ", clickable: false },
      { index: 2, char: "B", clickable: true },
    ])
  })

  it("uses only Tailwind default text color classes for active title feedback", () => {
    expect(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.length).toBeGreaterThan(3)
    expect(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.every((className) => {
      return className.startsWith("text-") && !className.includes("[") && !className.includes("#")
    })).toBe(true)
    expect(getSettingsTitleActiveColorClass(0, 0)).toBe(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[0])
    expect(getSettingsTitleActiveColorClass(0, 1)).toBe(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[1])
  })

  it("registers repository maintenance through the centralized registry", () => {
    const enableRepositoryMaintenance = vi.fn()

    expect(settingsCheatCodes).toHaveLength(1)
    expect(settingsCheatCodes[0]?.name).toBe("settings:repository-maintenance:enable")
    expect(settingsCheatCodes[0]?.settingsTitleSequence).toEqual([0, 11, 8, 9])

    settingsCheatCodes[0]?.run({ enableRepositoryMaintenance })

    expect(enableRepositoryMaintenance).toHaveBeenCalledTimes(1)
  })

  it("rejects duplicate cheat code names", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:test", settingsTitleSequence: [0] }),
        createRegistration({ name: "settings:test", settingsTitleSequence: [2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Duplicate cheat code name: settings:test")
  })

  it("rejects duplicate title sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:first", settingsTitleSequence: [0, 2] }),
        createRegistration({ name: "settings:second", settingsTitleSequence: [0, 2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Duplicate title sequence: 0,2")
  })

  it("rejects invalid names and empty sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: " ", settingsTitleSequence: [0] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Cheat code name is required.")

    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:empty", settingsTitleSequence: [] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Cheat code settingsTitleSequence is required for settings:empty.")
  })

  it("rejects invalid and non-clickable title indexes", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:outside", settingsTitleSequence: [99] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Title sequence index 99 is outside the title.")

    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:space", settingsTitleSequence: [1] }),
      ], buildSettingsTitleParts("A B")),
    ).toThrow("Title sequence index 1 is not clickable.")
  })

  it("rejects prefix conflicts between title sequences", () => {
    expect(() =>
      validateCheatCodeRegistrations([
        createRegistration({ name: "settings:short", settingsTitleSequence: [0, 1] }),
        createRegistration({ name: "settings:long", settingsTitleSequence: [0, 1, 2] }),
      ], buildSettingsTitleParts("ABC")),
    ).toThrow("Title sequence prefix conflict: settings:short and settings:long")
  })
})

function createRegistration(
  overrides: Partial<Omit<CheatCodeRegistration, "run">> = {},
): CheatCodeRegistration {
  return {
    name: "settings:test",
    settingsTitleSequence: [0],
    run: () => {},
    ...overrides,
  }
}
```

- [ ] **Step 2: Run registry tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/__tests__/cheat-codes.test.ts
```

Expected: FAIL because `@/modules/settings/cheat-codes` does not exist.

- [ ] **Step 3: Implement the registry**

Create `desktop/src/modules/settings/cheat-codes.ts`:

```ts
export const SETTINGS_CHEAT_CODE_TITLE = "Synapse AI Studio"
export const CHEAT_CODE_INTERACTION_RESET_DELAY = 10000
export const CHEAT_CODE_LOGO_CLICK_THRESHOLD = 10

export const SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES = [
  "text-red-500",
  "text-orange-500",
  "text-yellow-500",
  "text-lime-500",
  "text-cyan-500",
  "text-blue-500",
  "text-fuchsia-500",
] as const

export type SettingsTitlePart = {
  readonly index: number
  readonly char: string
  readonly clickable: boolean
}

export type CheatCodeContext = {
  readonly enableRepositoryMaintenance: () => void
}

export type CheatCodeRegistration = {
  readonly name: string
  readonly settingsTitleSequence: readonly number[]
  readonly run: (context: CheatCodeContext) => void
}

export function buildSettingsTitleParts(title: string = SETTINGS_CHEAT_CODE_TITLE): readonly SettingsTitlePart[] {
  return Array.from(title, (char, index) => ({
    index,
    char,
    clickable: char !== " ",
  }))
}

export function getSettingsTitleActiveColorClass(index: number, offset = 0): string {
  const classIndex = positiveModulo(index + offset, SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.length)
  return SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES[classIndex] ?? "text-foreground"
}

export const settingsTitleParts = buildSettingsTitleParts()

const registeredCheatCodes = [
  {
    name: "settings:repository-maintenance:enable",
    settingsTitleSequence: [0, 11, 8, 9],
    run: ({ enableRepositoryMaintenance }) => {
      enableRepositoryMaintenance()
    },
  },
] satisfies readonly CheatCodeRegistration[]

export const settingsCheatCodes = validateCheatCodeRegistrations(registeredCheatCodes)

export function validateCheatCodeRegistrations(
  registrations: readonly CheatCodeRegistration[],
  titleParts: readonly SettingsTitlePart[] = settingsTitleParts,
): readonly CheatCodeRegistration[] {
  const titlePartByIndex = new Map(titleParts.map((part) => [part.index, part]))
  const names = new Set<string>()
  const sequences = new Map<string, string>()

  for (const registration of registrations) {
    const name = registration.name.trim()

    if (!name) {
      throw new Error("Cheat code name is required.")
    }

    if (names.has(name)) {
      throw new Error(`Duplicate cheat code name: ${name}`)
    }

    names.add(name)

    if (registration.settingsTitleSequence.length === 0) {
      throw new Error(`Cheat code settingsTitleSequence is required for ${name}.`)
    }

    for (const index of registration.settingsTitleSequence) {
      if (!Number.isInteger(index)) {
        throw new Error(`Title sequence index ${index} is not an integer.`)
      }

      const titlePart = titlePartByIndex.get(index)

      if (!titlePart) {
        throw new Error(`Title sequence index ${index} is outside the title.`)
      }

      if (!titlePart.clickable) {
        throw new Error(`Title sequence index ${index} is not clickable.`)
      }
    }

    const sequenceKey = registration.settingsTitleSequence.join(",")
    const existingName = sequences.get(sequenceKey)

    if (existingName) {
      throw new Error(`Duplicate title sequence: ${sequenceKey}`)
    }

    sequences.set(sequenceKey, name)
  }

  for (let leftIndex = 0; leftIndex < registrations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < registrations.length; rightIndex += 1) {
      const left = registrations[leftIndex]
      const right = registrations[rightIndex]

      if (!left || !right) {
        continue
      }

      if (
        isPrefixSequence(left.settingsTitleSequence, right.settingsTitleSequence)
        || isPrefixSequence(right.settingsTitleSequence, left.settingsTitleSequence)
      ) {
        throw new Error(`Title sequence prefix conflict: ${left.name} and ${right.name}`)
      }
    }
  }

  return registrations
}

function isPrefixSequence(left: readonly number[], right: readonly number[]): boolean {
  if (left.length >= right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo
}
```

- [ ] **Step 4: Run registry tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/__tests__/cheat-codes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit registry changes**

```bash
git add desktop/src/modules/settings/cheat-codes.ts desktop/src/modules/settings/__tests__/cheat-codes.test.ts
git commit -m "feat(settings): add cheat code registry"
```

## Task 2: Title Sequence Hook

**Files:**
- Create: `desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx`
- Create: `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`

- [ ] **Step 1: Write the failing hook tests**

Create `desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  type CheatCodeContext,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"
import {
  findMatchingCheatCode,
  trimTitleSequenceBuffer,
  useCheatCodeTitleSequence,
} from "@/modules/settings/hooks/use-cheat-code-title-sequence"

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

    expect(findMatchingCheatCode([registration], [4, 0, 11, 8, 9])?.name).toBe("settings:test")
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

  it("ignores title clicks before arming", () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    clickTitleSequence([0, 11, 8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
  })

  it("runs a matched cheat code and exits armed mode", () => {
    const enableRepositoryMaintenance = vi.fn()
    const onTriggered = vi.fn()

    renderProbe({
      context: { enableRepositoryMaintenance },
      onTriggered,
    })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 11, 8, 9])

    expect(onTriggered).toHaveBeenCalledWith("settings:repository-maintenance:enable")
    expect(enableRepositoryMaintenance).toHaveBeenCalledTimes(1)
    expect(latestApi?.isArmed).toBe(false)
  })

  it("does not collapse repeated characters with different indexes", () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 0, 8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
    expect(latestApi?.isArmed).toBe(true)
  })

  it("clears partial input and exits armed mode after the shared timeout", () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({ context: { enableRepositoryMaintenance } })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 11])
    advanceSharedTimeout()
    clickTitleSequence([8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
    expect(latestApi?.isArmed).toBe(false)
  })
})

function renderProbe(props: {
  readonly cheatCodes?: readonly CheatCodeRegistration[]
  readonly context?: CheatCodeContext
  readonly onTriggered?: (name: string) => void
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
      />,
    )
  })
}

function Probe(props: {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
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

function clickTitleSequence(sequence: readonly number[]): void {
  for (const index of sequence) {
    act(() => {
      if (!latestApi) throw new Error("Probe not rendered")
      latestApi.handleTitleIndexClick(index)
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
    name,
    settingsTitleSequence,
    run: ({ enableRepositoryMaintenance }) => {
      enableRepositoryMaintenance()
    },
  }
}
```

- [ ] **Step 2: Run hook tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx
```

Expected: FAIL because `use-cheat-code-title-sequence.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  type CheatCodeContext,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"

type UseCheatCodeTitleSequenceOptions = {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
}

type UseCheatCodeTitleSequenceResult = {
  readonly isArmed: boolean
  readonly handleLogoClick: () => void
  readonly handleTitleIndexClick: (index: number) => void
}

export function useCheatCodeTitleSequence({
  cheatCodes,
  context,
  onTriggered,
}: UseCheatCodeTitleSequenceOptions): UseCheatCodeTitleSequenceResult {
  const [isArmed, setIsArmed] = useState(false)
  const bufferRef = useRef<readonly number[]>([])
  const logoClickCountRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxSequenceLength = useMemo(
    () => getMaxTitleSequenceLength(cheatCodes),
    [cheatCodes],
  )

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  const resetInteraction = useCallback(() => {
    clearResetTimer()
    bufferRef.current = []
    logoClickCountRef.current = 0
    setIsArmed(false)
  }, [clearResetTimer])

  const scheduleReset = useCallback(() => {
    clearResetTimer()
    resetTimerRef.current = setTimeout(() => {
      resetInteraction()
    }, CHEAT_CODE_INTERACTION_RESET_DELAY)
  }, [clearResetTimer, resetInteraction])

  useEffect(() => {
    return () => {
      clearResetTimer()
    }
  }, [clearResetTimer])

  const handleLogoClick = useCallback(() => {
    logoClickCountRef.current += 1

    if (logoClickCountRef.current >= CHEAT_CODE_LOGO_CLICK_THRESHOLD) {
      logoClickCountRef.current = 0
      bufferRef.current = []
      setIsArmed(true)
      scheduleReset()
      return
    }

    scheduleReset()
  }, [scheduleReset])

  const handleTitleIndexClick = useCallback((index: number) => {
    if (!isArmed) {
      return
    }

    const nextBuffer = trimTitleSequenceBuffer(
      [...bufferRef.current, index],
      maxSequenceLength,
    )
    const matchedCheatCode = findMatchingCheatCode(cheatCodes, nextBuffer)

    if (matchedCheatCode) {
      resetInteraction()
      onTriggered?.(matchedCheatCode.name)
      matchedCheatCode.run(context)
      return
    }

    bufferRef.current = nextBuffer
    scheduleReset()
  }, [cheatCodes, context, isArmed, maxSequenceLength, onTriggered, resetInteraction, scheduleReset])

  return {
    isArmed,
    handleLogoClick,
    handleTitleIndexClick,
  }
}

export function findMatchingCheatCode(
  cheatCodes: readonly CheatCodeRegistration[],
  buffer: readonly number[],
): CheatCodeRegistration | null {
  return cheatCodes.find((cheatCode) => endsWithSequence(buffer, cheatCode.settingsTitleSequence)) ?? null
}

export function trimTitleSequenceBuffer(buffer: readonly number[], maxLength: number): readonly number[] {
  if (maxLength <= 0) {
    return []
  }

  if (buffer.length <= maxLength) {
    return buffer
  }

  return buffer.slice(buffer.length - maxLength)
}

function getMaxTitleSequenceLength(cheatCodes: readonly CheatCodeRegistration[]): number {
  return cheatCodes.reduce(
    (maxLength, cheatCode) => Math.max(maxLength, cheatCode.settingsTitleSequence.length),
    0,
  )
}

function endsWithSequence(buffer: readonly number[], sequence: readonly number[]): boolean {
  if (sequence.length === 0 || sequence.length > buffer.length) {
    return false
  }

  const offset = buffer.length - sequence.length

  return sequence.every((value, index) => buffer[offset + index] === value)
}
```

- [ ] **Step 4: Run hook tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit hook changes**

```bash
git add desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx
git commit -m "feat(settings): add cheat code title sequence hook"
```

## Task 3: About Panel Integration

**Files:**
- Create: `desktop/src/modules/settings/components/__tests__/about-panel.test.tsx`
- Modify: `desktop/src/modules/settings/components/about-panel.tsx`

- [ ] **Step 1: Write the failing About panel tests**

Create `desktop/src/modules/settings/components/__tests__/about-panel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES,
} from "@/modules/settings/cheat-codes"
import { AboutPanel } from "@/modules/settings/components/about-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/assets/icon.png", () => ({
  default: "icon.png",
}))

let roots: Root[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  installUpdaterBridge()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.useRealTimers()
})

describe("AboutPanel cheat codes", () => {
  it("arms title input from logo clicks and enlarges the title", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(getTitle().className).toContain("text-4xl")
    expect(SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES).toContain(getTitlePart(0).className)
  })

  it("does not enable repository maintenance from logo clicks alone", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("enables repository maintenance from the registered title index sequence after arming", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 11, 8, 9])

    expect(onAdminModeChange).toHaveBeenCalledWith(true)
    expect(rendererLogger.info).toHaveBeenCalledWith("Cheat code activated.", {
      name: "settings:repository-maintenance:enable",
    })
    expect(getTitle().className).toContain("text-lg")
  })

  it("ignores title clicks before arming", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickTitleSequence([0, 11, 8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("treats the first S and second S as different inputs", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 0, 8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("reverts title size and color after the shared timeout with no title input", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    expect(getTitle().className).toContain("text-4xl")

    advanceSharedTimeout()

    expect(getTitle().className).toContain("text-lg")
    expect(getTitlePart(0).className).not.toContain("text-red-500")
  })

  it("cancels partial title input after the shared timeout", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    clickTitleSequence([0, 11])
    advanceSharedTimeout()
    clickTitleSequence([8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
    expect(getTitle().className).toContain("text-lg")
  })
})

async function renderAboutPanel(props: {
  readonly onAdminModeChange: (enabled: boolean) => void
}): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AboutPanel
        isAdminMode={false}
        onAdminModeChange={props.onAdminModeChange}
      />,
    )
    await Promise.resolve()
  })
}

function clickLogoTimes(count: number): void {
  const logo = getLogo()

  for (let clickIndex = 0; clickIndex < count; clickIndex += 1) {
    act(() => {
      logo.click()
    })
  }
}

function clickTitleSequence(sequence: readonly number[]): void {
  for (const index of sequence) {
    act(() => {
      getTitlePart(index).click()
    })
  }
}

function advanceSharedTimeout(): void {
  act(() => {
    vi.advanceTimersByTime(CHEAT_CODE_INTERACTION_RESET_DELAY)
  })
}

function getTitle(): HTMLHeadingElement {
  const title = document.body.querySelector("[data-settings-cheat-code-title]")

  if (!(title instanceof HTMLHeadingElement)) {
    throw new Error("Title not found")
  }

  return title
}

function getTitlePart(index: number): HTMLElement {
  const element = document.body.querySelector(`[data-settings-title-index="${index}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Title part ${index} not found`)
  }

  return element
}

function getLogo(): HTMLImageElement {
  const logo = document.body.querySelector('img[alt="Synapse"]')

  if (!(logo instanceof HTMLImageElement)) {
    throw new Error("Synapse logo not found")
  }

  return logo
}

function installUpdaterBridge(): void {
  const updater = {
    cancelDownload: vi.fn(),
    checkForUpdates: vi.fn(),
    getState: vi.fn().mockResolvedValue({
      bytesPerSecond: null,
      canCheck: false,
      currentVersion: "0.2.189",
      downloadPercent: null,
      error: null,
      lastCheckedAt: null,
      message: "当前已是最新版本。",
      releaseVersion: null,
      status: "idle",
      totalBytes: null,
      transferredBytes: null,
    }),
    installUpdate: vi.fn(),
    onStateChanged: vi.fn(() => () => {}),
  }

  ;(window as unknown as { synapse?: { updater: typeof updater } }).synapse = { updater }
}
```

- [ ] **Step 2: Run About panel tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/components/__tests__/about-panel.test.tsx
```

Expected: FAIL because title spans do not expose `data-settings-title-index`, logo clicks still trigger the old admin behavior directly, and the title never enters `text-4xl`.

- [ ] **Step 3: Integrate cheat codes into AboutPanel**

Modify imports in `desktop/src/modules/settings/components/about-panel.tsx`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import {
  SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES,
  SETTINGS_CHEAT_CODE_TITLE,
  getSettingsTitleActiveColorClass,
  settingsCheatCodes,
  settingsTitleParts,
  type CheatCodeContext,
} from "@/modules/settings/cheat-codes"
import { useCheatCodeTitleSequence } from "@/modules/settings/hooks/use-cheat-code-title-sequence"
import type { SynapseAppUpdateState } from "@/types/update"
import synapseLogo from "@/assets/icon.png"
```

Delete the old admin-click constants:

```ts
const ADMIN_CLICK_THRESHOLD = 10
const ADMIN_CLICK_RESET_DELAY = 2000
```

Delete the old logo-click state and timer:

```ts
const [clickCount, setClickCount] = useState(0)
const resetTimerRef = useRef<NodeJS.Timeout | null>(null)
```

Delete the old `handleLogoClick` callback and the timer cleanup effect.

Add this state and hook wiring before `handleAction`:

```ts
  const [activeTitleColorOffset, setActiveTitleColorOffset] = useState(0)

  const cheatCodeContext = useMemo<CheatCodeContext>(
    () => ({
      enableRepositoryMaintenance: () => {
        if (!isAdminMode) {
          onAdminModeChange(true)
        }
      },
    }),
    [isAdminMode, onAdminModeChange],
  )

  const handleCheatCodeTriggered = useCallback((name: string) => {
    logger.info("Cheat code activated.", { name })
  }, [])

  const {
    handleLogoClick,
    handleTitleIndexClick,
    isArmed: isCheatCodeEntryArmed,
  } = useCheatCodeTitleSequence({
    cheatCodes: settingsCheatCodes,
    context: cheatCodeContext,
    onTriggered: handleCheatCodeTriggered,
  })

  useEffect(() => {
    if (!isCheatCodeEntryArmed) {
      setActiveTitleColorOffset(0)
      return
    }

    const interval = setInterval(() => {
      setActiveTitleColorOffset(
        (current) => (current + 1) % SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.length,
      )
    }, 400)

    return () => {
      clearInterval(interval)
    }
  }, [isCheatCodeEntryArmed])
```

Replace the logo image block with an arming-only logo click:

```tsx
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <img
          src={synapseLogo}
          alt="Synapse"
          draggable={false}
          onClick={handleLogoClick}
          className="size-24 shrink-0 object-contain select-none"
        />
```

Replace the title `h1` with indexed title spans:

```tsx
          {/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <h1
            className={cn(
              "font-semibold tracking-tight",
              isCheatCodeEntryArmed ? "text-4xl" : "text-lg",
            )}
            aria-label={SETTINGS_CHEAT_CODE_TITLE}
            data-settings-cheat-code-title
          >
            {settingsTitleParts.map((part) => (
              <span
                key={part.index}
                aria-hidden="true"
                className={
                  isCheatCodeEntryArmed && part.clickable
                    ? getSettingsTitleActiveColorClass(part.index, activeTitleColorOffset)
                    : undefined
                }
                data-settings-title-index={part.index}
                onClick={part.clickable ? () => handleTitleIndexClick(part.index) : undefined}
              >
                {part.char}
              </span>
            ))}
          </h1>
          {/* eslint-enable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
```

- [ ] **Step 4: Run About panel tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/components/__tests__/about-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit About panel integration**

```bash
git add desktop/src/modules/settings/components/about-panel.tsx desktop/src/modules/settings/components/__tests__/about-panel.test.tsx
git commit -m "feat(settings): arm title cheat code from logo"
```

## Task 4: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add pending release note**

Under `## 功能优化`, add:

```md
- 关于页隐藏维护入口改为 logo 连点后输入标题字符暗号，避免连点直接打开维护入口。
```

- [ ] **Step 2: Run the focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/settings/__tests__/cheat-codes.test.ts \
  desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx \
  desktop/src/modules/settings/components/__tests__/about-panel.test.tsx
```

Expected: PASS for all three test files.

- [ ] **Step 3: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Verify no forbidden UI styling was introduced**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|glow|shadow-|console\\.log" \
  desktop/src/modules/settings/cheat-codes.ts \
  desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts \
  desktop/src/modules/settings/components/about-panel.tsx \
  desktop/src/modules/settings/__tests__/cheat-codes.test.ts \
  desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx \
  desktop/src/modules/settings/components/__tests__/about-panel.test.tsx
```

Expected: no output.

- [ ] **Step 5: Commit release note and verification-ready state**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note logo-armed title cheat code"
```

## Final Review

- [ ] Confirm `AGENTS.md` already documents the cheat code guidance and does not reveal the title sequence.
- [ ] Confirm `AboutPanel` no longer contains `ADMIN_CLICK_THRESHOLD`, `ADMIN_CLICK_RESET_DELAY`, `clickCount`, or old direct-admin logo behavior.
- [ ] Confirm the only 10000 ms cheat-code interaction timeout lives in `desktop/src/modules/settings/cheat-codes.ts`.
- [ ] Confirm the active title feedback uses Tailwind default text color classes only, with no custom colors, glow, gradients, inline styles, or CSS keyframes.
- [ ] Confirm logs contain only the cheat code name and never the clicked index buffer.
- [ ] Confirm no development server, browser preview, Playwright, Chrome, or runtime debugger was started.
