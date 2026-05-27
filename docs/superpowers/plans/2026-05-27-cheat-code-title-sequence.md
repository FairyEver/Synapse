# Cheat Code Title Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings-local cheat code system and replace the About page logo click hidden entry with a title-character index sequence.

**Architecture:** `cheat-codes.ts` owns stable cheat code names, the current settings title input binding, callbacks, and registry validation. `use-cheat-code-title-sequence.ts` owns only index buffering, timeout reset, suffix matching, and callback dispatch. `AboutPanel` renders the existing title as visually unchanged clickable spans and supplies the action context.

**Tech Stack:** Electron renderer, React 19, TypeScript, Vitest, jsdom, shadcn/Radix/Tailwind existing UI baseline.

---

## File Structure

- Create `desktop/src/modules/settings/cheat-codes.ts`: settings-local cheat code registry, title parts, validation helpers, and callback types.
- Create `desktop/src/modules/settings/__tests__/cheat-codes.test.ts`: pure unit tests for title parts, registry contents, callbacks, and validation failures.
- Create `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`: hook and small pure helpers for sequence matching and buffer trimming.
- Create `desktop/src/modules/settings/hooks/__tests__/use-cheat-code-title-sequence.test.tsx`: hook tests for matching, timeout, wrong repeated character index, and trigger callback.
- Create `desktop/src/modules/settings/components/__tests__/about-panel.test.tsx`: About panel integration tests for title index clicks and removed logo click behavior.
- Modify `desktop/src/modules/settings/components/about-panel.tsx`: remove logo ten-click state; wire title spans to the hook.
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
  SETTINGS_CHEAT_CODE_TITLE,
  buildSettingsTitleParts,
  settingsCheatCodes,
  settingsTitleParts,
  validateCheatCodeRegistrations,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"

describe("settings cheat codes", () => {
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

import type { CheatCodeContext, CheatCodeRegistration } from "@/modules/settings/cheat-codes"
import {
  CHEAT_CODE_TITLE_SEQUENCE_RESET_DELAY,
  findMatchingCheatCode,
  trimTitleSequenceBuffer,
  useCheatCodeTitleSequence,
} from "@/modules/settings/hooks/use-cheat-code-title-sequence"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let clickTitleIndex: ((index: number) => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  clickTitleIndex = null
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  clickTitleIndex = null
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

  it("runs a matched cheat code and reports its name", () => {
    const enableRepositoryMaintenance = vi.fn()
    const onTriggered = vi.fn()

    renderProbe({
      cheatCodes: [
        createRegistration("settings:repository-maintenance:enable", [0, 11, 8, 9]),
      ],
      context: { enableRepositoryMaintenance },
      onTriggered,
    })

    clickSequence([0, 11, 8, 9])

    expect(onTriggered).toHaveBeenCalledWith("settings:repository-maintenance:enable")
    expect(enableRepositoryMaintenance).toHaveBeenCalledTimes(1)
  })

  it("does not collapse repeated characters with different indexes", () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({
      cheatCodes: [
        createRegistration("settings:repository-maintenance:enable", [0, 11, 8, 9]),
      ],
      context: { enableRepositoryMaintenance },
    })

    clickSequence([0, 0, 8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
  })

  it("clears partial input after ten seconds", () => {
    const enableRepositoryMaintenance = vi.fn()

    renderProbe({
      cheatCodes: [
        createRegistration("settings:repository-maintenance:enable", [0, 11, 8, 9]),
      ],
      context: { enableRepositoryMaintenance },
    })

    clickSequence([0, 11])

    act(() => {
      vi.advanceTimersByTime(CHEAT_CODE_TITLE_SEQUENCE_RESET_DELAY)
    })

    clickSequence([8, 9])

    expect(enableRepositoryMaintenance).not.toHaveBeenCalled()
  })
})

function renderProbe(props: {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
}): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<Probe {...props} />)
  })
}

function Probe(props: {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
}) {
  clickTitleIndex = useCheatCodeTitleSequence(props)
  return null
}

function clickSequence(sequence: readonly number[]): void {
  for (const index of sequence) {
    act(() => {
      if (!clickTitleIndex) throw new Error("Probe not rendered")
      clickTitleIndex(index)
    })
  }
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
import { useCallback, useEffect, useMemo, useRef } from "react"

import type { CheatCodeContext, CheatCodeRegistration } from "@/modules/settings/cheat-codes"

export const CHEAT_CODE_TITLE_SEQUENCE_RESET_DELAY = 10000

type UseCheatCodeTitleSequenceOptions = {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
  readonly resetDelayMs?: number
}

export function useCheatCodeTitleSequence({
  cheatCodes,
  context,
  onTriggered,
  resetDelayMs = CHEAT_CODE_TITLE_SEQUENCE_RESET_DELAY,
}: UseCheatCodeTitleSequenceOptions): (index: number) => void {
  const bufferRef = useRef<readonly number[]>([])
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

  const clearBuffer = useCallback(() => {
    bufferRef.current = []
    clearResetTimer()
  }, [clearResetTimer])

  useEffect(() => clearBuffer, [clearBuffer])

  return useCallback((index: number) => {
    clearResetTimer()

    const nextBuffer = trimTitleSequenceBuffer(
      [...bufferRef.current, index],
      maxSequenceLength,
    )
    const matchedCheatCode = findMatchingCheatCode(cheatCodes, nextBuffer)

    if (matchedCheatCode) {
      bufferRef.current = []
      onTriggered?.(matchedCheatCode.name)
      matchedCheatCode.run(context)
      return
    }

    bufferRef.current = nextBuffer
    resetTimerRef.current = setTimeout(() => {
      bufferRef.current = []
      resetTimerRef.current = null
    }, resetDelayMs)
  }, [cheatCodes, clearResetTimer, context, maxSequenceLength, onTriggered, resetDelayMs])
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
})

describe("AboutPanel cheat codes", () => {
  it("enables repository maintenance from the registered title index sequence", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickTitleSequence([0, 11, 8, 9])

    expect(onAdminModeChange).toHaveBeenCalledWith(true)
    expect(rendererLogger.info).toHaveBeenCalledWith("Cheat code activated.", {
      name: "settings:repository-maintenance:enable",
    })
  })

  it("treats the first S and second S as different inputs", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickTitleSequence([0, 0, 8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("does not enable repository maintenance from old logo clicks", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })
    const logo = getLogo()

    for (let clickIndex = 0; clickIndex < 10; clickIndex += 1) {
      act(() => {
        logo.click()
      })
    }

    expect(onAdminModeChange).not.toHaveBeenCalled()
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

function clickTitleSequence(sequence: readonly number[]): void {
  for (const index of sequence) {
    act(() => {
      getTitlePart(index).click()
    })
  }
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

Expected: FAIL because title spans do not expose `data-settings-title-index` and the old logo click behavior still enables admin mode.

- [ ] **Step 3: Integrate cheat codes into AboutPanel**

Modify the import line in `desktop/src/modules/settings/components/about-panel.tsx`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import {
  SETTINGS_CHEAT_CODE_TITLE,
  settingsCheatCodes,
  settingsTitleParts,
  type CheatCodeContext,
} from "@/modules/settings/cheat-codes"
import { useCheatCodeTitleSequence } from "@/modules/settings/hooks/use-cheat-code-title-sequence"
import type { SynapseAppUpdateState } from "@/types/update"
import synapseLogo from "@/assets/icon.png"
```

Delete these old logo-click constants:

```ts
const ADMIN_CLICK_THRESHOLD = 10
const ADMIN_CLICK_RESET_DELAY = 2000
```

Delete these old state and timer lines inside `AboutPanel`:

```ts
const [clickCount, setClickCount] = useState(0)
const resetTimerRef = useRef<NodeJS.Timeout | null>(null)
```

Delete the old `handleLogoClick` callback and the timer cleanup effect.

Add this callback wiring before `handleAction`:

```ts
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

  const handleTitleIndexClick = useCheatCodeTitleSequence({
    cheatCodes: settingsCheatCodes,
    context: cheatCodeContext,
    onTriggered: handleCheatCodeTriggered,
  })
```

Replace the logo image block with a non-clicking logo:

```tsx
        <img
          src={synapseLogo}
          alt="Synapse"
          draggable={false}
          className="size-24 shrink-0 object-contain select-none"
        />
```

Replace the title `h1` with indexed title spans:

```tsx
          {/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <h1
            className="text-lg font-semibold tracking-tight"
            aria-label={SETTINGS_CHEAT_CODE_TITLE}
          >
            {settingsTitleParts.map((part) => (
              <span
                key={part.index}
                aria-hidden="true"
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
git commit -m "feat(settings): trigger maintenance from title cheat code"
```

## Task 4: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add pending release note**

Under `## 功能优化`, add:

```md
- 关于页隐藏维护入口改为标题字符暗号，原来的 logo 连点入口不再触发。
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
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" \
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
git commit -m "docs: note title cheat code entry"
```

## Final Review

- [ ] Confirm `AGENTS.md` already documents the cheat code guidance and does not reveal the title sequence.
- [ ] Confirm `AboutPanel` no longer contains `ADMIN_CLICK_THRESHOLD`, `clickCount`, or `handleLogoClick`.
- [ ] Confirm logs contain only the cheat code name and never the clicked index buffer.
- [ ] Confirm no development server, browser preview, Playwright, Chrome, or runtime debugger was started.
