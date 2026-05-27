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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/assets/icon.png", () => ({
  default: "icon.png",
}))

import { AboutPanel } from "@/modules/settings/components/about-panel"

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
  it("arms title input from logo clicks with subtle animated letter spacing", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(getTitle().className).toContain("tracking-tight")

    clickLogoTimes(CHEAT_CODE_LOGO_CLICK_THRESHOLD)

    expect(getTitle().className).toContain("text-lg")
    expect(getTitle().className).not.toContain("text-4xl")
    expect(getTitle().className).toContain("tracking-wider")
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
    expect(getTitlePart(0).className).toContain("transition-[color,transform,font-weight]")
    expect(getTitlePart(0).className).toContain("duration-200")
    expect(getTitlePart(0).className).toContain("ease-out")
    expect(getTitlePart(0).className).toContain("hover:scale-110")
    expect(getTitlePart(0).className).toContain("hover:font-bold")
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
