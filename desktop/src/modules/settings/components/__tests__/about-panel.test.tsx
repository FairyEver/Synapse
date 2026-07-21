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
import type { SynapseAppUpdateOpenRequest, SynapseAppUpdateState } from "@/types/update"

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
let updateOpenRequestListeners: Array<(request: SynapseAppUpdateOpenRequest) => void> = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  updaterStateListeners = []
  updateOpenRequestListeners = []
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

describe("AboutPanel", () => {
  it("checks for updates when the panel opens", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(getUpdaterBridge().checkForUpdatesOnPageEnter).toHaveBeenCalledTimes(1)
  })

  it("acknowledges a manual update-open request after the panel takes over navigation", async () => {
    const updater = getUpdaterBridge()
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 7, automatic: false })

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(7)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it("bypasses the page-entry cooldown path with an explicit check for an automatic idle request", async () => {
    const updater = getUpdaterBridge()
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 8, automatic: true })
    vi.mocked(updater.checkForUpdates).mockResolvedValue(updateState({
      canCheck: false,
      message: "正在检查更新...",
      status: "checking",
    }))

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.checkForUpdatesOnPageEnter).toHaveBeenCalledTimes(1)
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(8)
  })

  it("acknowledges a hot manual request while the panel is already mounted", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await act(async () => {
      emitUpdateOpenRequest({ id: 9, automatic: false })
      await Promise.resolve()
    })

    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(9)
  })

  it("starts the existing download when an automatic request finds an available update", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await emitStateAndAutomaticRequest(updateState({
      message: "发现新版本 v0.2.190。",
      releaseVersion: "0.2.190",
      status: "available",
    }), 10)

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(10)
  })

  it("waits for an existing check and downloads when it becomes available", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await emitStateAndAutomaticRequest(updateState({
      message: "正在检查更新...",
      status: "checking",
    }), 11)

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    await act(async () => {
      emitUpdaterState(updateState({
        message: "发现新版本 v0.2.190。",
        releaseVersion: "0.2.190",
        status: "available",
      }))
      await Promise.resolve()
    })

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it("starts the shared install countdown when an automatic request finds a downloaded update", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await emitStateAndAutomaticRequest(updateState({
      downloadPercent: 100,
      message: "新版本 v0.2.190 已下载。",
      releaseVersion: "0.2.190",
      status: "downloaded",
    }), 12)

    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
    expect(getButtonWithText("稍后安装")).toBeTruthy()
  })

  it("waits for an existing download and starts the countdown when it completes", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await emitStateAndAutomaticRequest(updateState({
      downloadPercent: 40,
      releaseVersion: "0.2.190",
      status: "downloading",
    }), 19)

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    act(() => {
      emitUpdaterState(updateState({
        downloadPercent: 100,
        releaseVersion: "0.2.190",
        status: "downloaded",
      }))
    })

    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
  })

  it("does not restart the shared countdown for a repeated automatic request", async () => {
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    await emitStateAndAutomaticRequest(updateState({
      downloadPercent: 100,
      releaseVersion: "0.2.190",
      status: "downloaded",
    }), 20)
    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(getButtonWithText("2 秒后安装").disabled).toBe(true)

    await act(async () => {
      emitUpdateOpenRequest({ id: 21, automatic: true })
      await Promise.resolve()
    })

    expect(getButtonWithText("2 秒后安装").disabled).toBe(true)
  })

  it("uses the loaded updater state before taking over a cold automatic request", async () => {
    const updater = getUpdaterBridge()
    const downloadedState = updateState({
      downloadPercent: 100,
      releaseVersion: "0.2.190",
      status: "downloaded",
    })
    vi.mocked(updater.getState).mockResolvedValue(downloadedState)
    vi.mocked(updater.checkForUpdatesOnPageEnter).mockResolvedValue(downloadedState)
    vi.mocked(updater.checkForUpdates).mockResolvedValue(downloadedState)
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 17, automatic: true })

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
  })

  it("continues from the state returned by an explicit automatic check", async () => {
    const updater = getUpdaterBridge()
    let resolveInitialState: ((state: SynapseAppUpdateState) => void) | undefined
    vi.mocked(updater.getState).mockImplementation(() => new Promise((resolve) => {
      resolveInitialState = resolve
    }))
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 23, automatic: true })
    vi.mocked(updater.checkForUpdates).mockResolvedValue(updateState({
      message: "发现新版本 v0.2.190。",
      releaseVersion: "0.2.190",
      status: "available",
    }))

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(23)

    await act(async () => {
      resolveInitialState?.(updateState({ canCheck: true }))
      await Promise.resolve()
    })
  })

  it("stops automatic progression after an updater error", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({ message: "正在检查更新...", status: "checking" }))
    })
    await act(async () => {
      emitUpdateOpenRequest({ id: 13, automatic: true })
      await Promise.resolve()
      emitUpdaterState(updateState({
        canCheck: true,
        error: "检查更新失败，请稍后再试。",
        message: "检查更新失败，请稍后再试。",
        status: "error",
      }))
      emitUpdaterState(updateState({
        releaseVersion: "0.2.190",
        status: "available",
      }))
      await Promise.resolve()
    })

    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(getButtonWithText("下载并安装")).toBeTruthy()
  })

  it("shows an automatic action failure once without retrying it", async () => {
    const updater = getUpdaterBridge()
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 18, automatic: true })
    vi.mocked(updater.checkForUpdates).mockRejectedValue(new Error("自动检查失败"))

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(document.body.textContent).toContain("自动检查失败")
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(18)
  })

  it("finishes automatic progression when the current version is already latest", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({ message: "正在检查更新...", status: "checking" }))
    })
    await act(async () => {
      emitUpdateOpenRequest({ id: 14, automatic: true })
      await Promise.resolve()
      emitUpdaterState(updateState({
        canCheck: true,
        message: "当前已经是最新版本。",
        status: "not-available",
      }))
      emitUpdaterState(updateState({
        releaseVersion: "0.2.190",
        status: "available",
      }))
      await Promise.resolve()
    })

    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it("coalesces repeated automatic requests while the same download action is pending", async () => {
    const updater = getUpdaterBridge()
    let resolveDownload: ((state: SynapseAppUpdateState) => void) | undefined
    vi.mocked(updater.downloadUpdate).mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve
    }))
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        releaseVersion: "0.2.190",
        status: "available",
      }))
    })
    await act(async () => {
      emitUpdateOpenRequest({ id: 15, automatic: true })
      emitUpdateOpenRequest({ id: 16, automatic: true })
      await Promise.resolve()
    })

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDownload?.(updateState({
        releaseVersion: "0.2.190",
        status: "downloading",
      }))
      await Promise.resolve()
    })

    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(15)
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(16)
  })

  it("downloads only after the user confirms the available update", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        message: "发现新版本 v0.2.190。",
        releaseVersion: "0.2.190",
        status: "available",
      }))
    })

    await act(async () => {
      getButtonWithText("下载并安装").click()
      await Promise.resolve()
    })

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it("installs automatically after a visible three-second countdown", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        message: "发现新版本 v0.2.190。",
        releaseVersion: "0.2.190",
        status: "available",
      }))
    })
    await act(async () => {
      getButtonWithText("下载并安装").click()
      await Promise.resolve()
    })
    act(() => {
      emitUpdaterState(updateState({
        downloadPercent: 100,
        message: "新版本 v0.2.190 已下载。",
        releaseVersion: "0.2.190",
        status: "downloaded",
      }))
    })

    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
    expect(getButtonWithText("稍后安装")).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      await Promise.resolve()
    })

    expect(updater.installUpdate).toHaveBeenCalledTimes(1)
  })

  it("keeps the update ready after postponing and lets a new automatic request re-arm it", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        releaseVersion: "0.2.190",
        status: "available",
      }))
    })
    await act(async () => {
      getButtonWithText("下载并安装").click()
      await Promise.resolve()
    })
    act(() => {
      emitUpdaterState(updateState({
        downloadPercent: 100,
        releaseVersion: "0.2.190",
        status: "downloaded",
      }))
    })
    act(() => {
      getButtonWithText("稍后安装").click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(updater.installUpdate).not.toHaveBeenCalled()
    expect(getButtonWithText("立即安装")).toBeTruthy()

    await act(async () => {
      emitUpdateOpenRequest({ id: 22, automatic: true })
      await Promise.resolve()
    })

    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
  })

  it("re-arms a downloaded update from a new request after leaving and re-entering", async () => {
    const updater = getUpdaterBridge()
    const downloadedState = updateState({
      downloadPercent: 100,
      message: "新版本 v0.2.190 已下载。",
      releaseVersion: "0.2.190",
      status: "downloaded",
    })
    await renderAboutPanel({ onAdminModeChange: vi.fn() })
    await emitStateAndAutomaticRequest(downloadedState, 24)

    const firstRoot = roots.pop()
    act(() => {
      firstRoot?.unmount()
    })

    vi.mocked(updater.getState).mockResolvedValue(downloadedState)
    vi.mocked(updater.checkForUpdatesOnPageEnter).mockResolvedValue(downloadedState)
    vi.mocked(updater.getPendingOpenRequest).mockResolvedValue({ id: 25, automatic: true })

    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    expect(getButtonWithText("3 秒后安装").disabled).toBe(true)
    expect(updater.acknowledgeOpenRequest).toHaveBeenCalledWith(25)
  })

  it("shows an exit-gate rejection after countdown without retrying installation", async () => {
    const updater = getUpdaterBridge()
    vi.mocked(updater.installUpdate).mockRejectedValue(
      new Error("知识库迁移尚未安全完成，请稍后再安装更新。"),
    )
    await renderAboutPanel({ onAdminModeChange: vi.fn() })
    await emitStateAndAutomaticRequest(updateState({
      downloadPercent: 100,
      releaseVersion: "0.2.190",
      status: "downloaded",
    }), 26)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("知识库迁移尚未安全完成，请稍后再安装更新。")
    expect(updater.installUpdate).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })

    expect(updater.installUpdate).toHaveBeenCalledTimes(1)
  })

  it("does not auto-install when the panel is left before download completes", async () => {
    const updater = getUpdaterBridge()
    await renderAboutPanel({ onAdminModeChange: vi.fn() })

    act(() => {
      emitUpdaterState(updateState({
        releaseVersion: "0.2.190",
        status: "available",
      }))
    })
    await act(async () => {
      getButtonWithText("下载并安装").click()
      await Promise.resolve()
    })

    const root = roots.pop()
    act(() => {
      root?.unmount()
    })
    act(() => {
      emitUpdaterState(updateState({
        downloadPercent: 100,
        releaseVersion: "0.2.190",
        status: "downloaded",
      }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(updater.installUpdate).not.toHaveBeenCalled()
  })

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
    await Promise.resolve()
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

function getButtonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((element) => element.textContent === text)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button ${text} not found`)
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
  const initialState = updateState({
    canCheck: true,
    currentVersion: "0.2.189",
    message: "当前已是最新版本。",
  })
  const updater = {
    acknowledgeOpenRequest: vi.fn(),
    cancelDownload: vi.fn(),
    checkForUpdates: vi.fn(),
    checkForUpdatesOnPageEnter: vi.fn().mockResolvedValue(initialState),
    downloadUpdate: vi.fn().mockResolvedValue(updateState({
      currentVersion: "0.2.189",
      downloadPercent: 0,
      message: "正在下载更新...",
      releaseVersion: "0.2.190",
      status: "downloading",
      transferredBytes: 0,
    })),
    getPendingOpenRequest: vi.fn().mockResolvedValue(null),
    getState: vi.fn().mockResolvedValue(initialState),
    installUpdate: vi.fn(),
    onOpenRequest: vi.fn((listener: (request: SynapseAppUpdateOpenRequest) => void) => {
      updateOpenRequestListeners.push(listener)
      return () => {
        updateOpenRequestListeners = updateOpenRequestListeners.filter((item) => item !== listener)
      }
    }),
    onOpenUpdatePage: vi.fn(() => () => undefined),
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

function emitUpdateOpenRequest(request: SynapseAppUpdateOpenRequest): void {
  for (const listener of updateOpenRequestListeners) {
    listener(request)
  }
}

async function emitStateAndAutomaticRequest(
  state: SynapseAppUpdateState,
  requestId: number,
): Promise<void> {
  act(() => {
    emitUpdaterState(state)
  })
  await act(async () => {
    emitUpdateOpenRequest({ automatic: true, id: requestId })
    await Promise.resolve()
  })
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
