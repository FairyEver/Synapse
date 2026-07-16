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
  WORKFLOW_ENTRY_TITLE_SEQUENCE,
} from "@/modules/settings/cheat-codes"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import type { SynapseAppUpdateState } from "@/types/update"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const toast = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/assets/icon.png", () => ({
  default: "icon.png",
}))

vi.mock("sonner", () => ({
  toast,
}))

import { AboutPanel } from "@/modules/settings/components/about-panel"

let roots: Root[] = []
let updaterStateListeners: Array<(state: SynapseAppUpdateState) => void> = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  updaterStateListeners = []
  installUpdaterBridge()
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
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
  it("marks version and update details as selectable text", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        bytesPerSecond: 320 * 1024,
        currentVersion: "0.2.282",
        downloadPercent: 11.5,
        message: "正在下载更新...",
        releaseVersion: "0.2.284",
        status: "downloading",
        totalBytes: 58.3 * 1024 * 1024,
        transferredBytes: 6.7 * 1024 * 1024,
      }))
    })

    expect(isInsideSelectableText(getElementWithText("v0.2.282"))).toBe(true)
    expect(isInsideSelectableText(getElementWithText("软件更新"))).toBe(true)
    expect(isInsideSelectableText(getElementWithText("正在下载更新..."))).toBe(true)
    expect(isInsideSelectableText(getElementWithText("最新版本：v0.2.284"))).toBe(true)
    expect(isInsideSelectableText(getElementWithText("下载进度"))).toBe(true)
    expect(isInsideSelectableText(getElementWithText(/已下载 6\.7 MB \/ 58\.3 MB/))).toBe(true)
  })

  it("copies the visible app version when clicked", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    const versionButton = getVersionButton()

    await act(async () => {
      versionButton.click()
      await Promise.resolve()
    })

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith("v0.2.189")
    expect(toast).toHaveBeenCalledWith("版本号已复制")
  })

  it("clears stale update action errors when a fresh updater state arrives", async () => {
    const updater = getUpdaterBridge()
    vi.mocked(updater.getState).mockResolvedValueOnce(updateState({
      canCheck: true,
      message: "当前已是最新版本。",
      status: "idle",
    }))
    vi.mocked(updater.checkForUpdates).mockRejectedValueOnce(new Error("检查失败"))

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await act(async () => {
      getUpdateActionButton().click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("检查失败")

    act(() => {
      emitUpdaterState(updateState({
        canCheck: false,
        message: "正在检查更新...",
        status: "checking",
      }))
    })

    expect(document.body.textContent).not.toContain("检查失败")
    expect(document.body.textContent).toContain("正在检查更新...")
  })

  it("arms title input from logo clicks with subtle animated letter spacing", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(getTitle().className).toContain("tracking-tight")

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(getTitle().className).toContain("text-lg")
    expect(getTitle().className).not.toContain("text-4xl")
    expect(getTitle().className).toContain("tracking-widest")
    expect(getTitle().className).toContain("transition-[letter-spacing]")
    expect(getTitle().className).toContain("duration-300")
    expect(
      getTitlePart(0).className.split(/\s+/).some((className) =>
        SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES.includes(
          className as (typeof SETTINGS_CHEAT_CODE_ACTIVE_TITLE_COLOR_CLASSES)[number],
        ),
      ),
    ).toBe(true)
  })

  it("smooths active title color and hover scale changes", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(getTitlePart(0).className).toContain("inline-block")
    expect(getTitlePart(0).className).toContain("transition-[color,transform,font-weight,opacity]")
    expect(getTitlePart(0).className).toContain("duration-200")
    expect(getTitlePart(0).className).toContain("ease-out")
    expect(getTitlePart(0).className).toContain("hover:scale-125")
    expect(getTitlePart(0).className).toContain("hover:font-bold")
  })

  it("dims other active title characters while one character is hovered", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    hoverTitlePart(0)

    expect(getTitlePart(0).className).not.toContain("opacity-50")
    expect(getTitlePart(1).className).toContain("opacity-30")

    leaveTitlePart(0)

    expect(getTitlePart(1).className).not.toContain("opacity-30")
  })

  it("moves each active title color one character to the right on each tick", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    const firstColor = getTitlePart(0).className

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(getTitlePart(1).className).toBe(firstColor)
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
    await clickTitleSequence([0, 11, 8, 9])

    expect(onAdminModeChange).toHaveBeenCalledWith(true)
    expect(rendererLogger.info).toHaveBeenCalledWith("Cheat code activated.", {
      name: "settings:repository-maintenance:enable",
    })
    expect(getTitle().className).toContain("text-lg")
  })

  it("toggles the workflow entry state from the registered title index sequence after arming", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence(WORKFLOW_ENTRY_TITLE_SEQUENCE)

    expect(getCheatCodeBridge().toggleState).toHaveBeenCalledWith(WORKFLOW_ENTRY_CHEAT_CODE_NAME)
    expect(onAdminModeChange).not.toHaveBeenCalled()
    expect(rendererLogger.info).toHaveBeenCalledWith("Cheat code activated.", {
      active: true,
      name: WORKFLOW_ENTRY_CHEAT_CODE_NAME,
    })
  })

  it("ignores title clicks before arming", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    await clickTitleSequence([0, 11, 8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("treats the first S and second S as different inputs", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence([0, 0, 8, 9])

    expect(onAdminModeChange).not.toHaveBeenCalled()
  })

  it("reverts title color after the shared timeout with no title input", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    expect(getTitle().className).toContain("text-lg")

    advanceSharedTimeout()

    expect(getTitle().className).toContain("text-lg")
    expect(getTitlePart(0).className).not.toContain("text-red-500")
  })

  it("cancels partial title input after the shared timeout", async () => {
    const onAdminModeChange = vi.fn()
    await renderAboutPanel({ onAdminModeChange })

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)
    await clickTitleSequence([0, 11])
    advanceSharedTimeout()
    await clickTitleSequence([8, 9])

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

async function clickTitleSequence(sequence: readonly number[]): Promise<void> {
  for (const index of sequence) {
    await act(async () => {
      getTitlePart(index).click()
      await Promise.resolve()
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

function getVersionButton(): HTMLButtonElement {
  const button = document.body.querySelector('button[aria-label="复制当前版本 v0.2.189"]')

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Version copy button not found")
  }

  return button
}

function getElementWithText(text: string | RegExp): HTMLElement {
  const element = Array.from(document.body.querySelectorAll("*"))
    .reverse()
    .find((candidate) => {
      const content = candidate.textContent ?? ""

      return typeof text === "string" ? content === text : text.test(content)
    })

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Element with text ${String(text)} not found`)
  }

  return element
}

function isInsideSelectableText(element: HTMLElement): boolean {
  return element.closest('[data-allow-select="true"]') !== null
}

function getUpdateActionButton(): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((element) => element.textContent === "检查更新")

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Update action button not found")
  }

  return button
}

function hoverTitlePart(index: number): void {
  act(() => {
    getTitlePart(index).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  })
}

function leaveTitlePart(index: number): void {
  act(() => {
    getTitlePart(index).dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
  })
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
    onStateChanged: vi.fn((listener: (state: SynapseAppUpdateState) => void) => {
      updaterStateListeners.push(listener)
      return () => {
        updaterStateListeners = updaterStateListeners.filter((item) => item !== listener)
      }
    }),
  }

  const states = new Map<string, boolean>()
  const cheatCodes = {
    getStates: vi.fn(async (names?: readonly string[]) => {
      if (!names) {
        return Object.fromEntries(states)
      }

      return Object.fromEntries(names.map((name) => [name, states.get(name) ?? false]))
    }),
    setState: vi.fn(async ({ name, active }: { readonly name: string; readonly active: boolean }) => {
      states.set(name, active)
      return { active, name }
    }),
    toggleState: vi.fn(async (name: string) => {
      const active = !(states.get(name) ?? false)
      states.set(name, active)
      return { active, name }
    }),
    onStateChanged: vi.fn(() => () => {}),
  }

  ;(window as unknown as { synapse?: { updater: typeof updater; cheatCodes: typeof cheatCodes } }).synapse = {
    cheatCodes,
    updater,
  }
}

function updateState(overrides: Partial<SynapseAppUpdateState>): SynapseAppUpdateState {
  return {
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
    ...overrides,
  }
}

function emitUpdaterState(state: SynapseAppUpdateState): void {
  for (const listener of updaterStateListeners) {
    listener(state)
  }
}

function getUpdaterBridge(): NonNullable<Window["synapse"]>["updater"] {
  const bridge = window.synapse?.updater

  if (!bridge) {
    throw new Error("Updater bridge not found")
  }

  return bridge
}

function getCheatCodeBridge(): NonNullable<Window["synapse"]>["cheatCodes"] {
  const bridge = window.synapse?.cheatCodes

  if (!bridge) {
    throw new Error("Cheat code bridge not found")
  }

  return bridge
}
