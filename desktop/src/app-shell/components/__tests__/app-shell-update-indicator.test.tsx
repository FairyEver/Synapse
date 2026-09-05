/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseAppUpdateState } from "@/types/update"

const getState = vi.fn<() => Promise<SynapseAppUpdateState>>()
const onStateChanged = vi.fn<(listener: (state: SynapseAppUpdateState) => void) => () => void>()
const downloadUpdate = vi.fn<() => Promise<SynapseAppUpdateState>>()
const installUpdate = vi.fn<() => Promise<void>>()

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    updater: { downloadUpdate, getState, installUpdate, onStateChanged },
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}))

vi.mock("@/lib/ui-tracking", () => ({
  runTrackedOperation: (_input: unknown, action: () => Promise<unknown>) => action(),
  track: vi.fn(),
}))

import { AppShellUpdateIndicator } from "../app-shell-update-indicator"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseState: SynapseAppUpdateState = {
  currentVersion: "0.2.428",
  releaseVersion: null,
  status: "idle",
  message: "可以检查新版本。",
  error: null,
  downloadPercent: null,
  bytesPerSecond: null,
  transferredBytes: null,
  totalBytes: null,
  lastCheckedAt: null,
  canCheck: true,
  installRecovery: null,
}

let roots: Root[] = []

beforeEach(() => {
  getState.mockResolvedValue(baseState)
  downloadUpdate.mockResolvedValue(baseState)
  installUpdate.mockResolvedValue(undefined)
  onStateChanged.mockImplementation(() => () => undefined)
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AppShellUpdateIndicator", () => {
  it("starts downloading an available update without navigating away", async () => {
    const updateState = {
      ...baseState,
      releaseVersion: "0.2.429",
      status: "available" as const,
      message: "发现新版本 v0.2.429。",
    }
    getState.mockResolvedValue(updateState)
    downloadUpdate.mockResolvedValue({
      ...updateState,
      status: "downloading",
      message: "正在下载更新...",
      downloadPercent: 0,
    })
    const emitState = subscribeAndRender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("发现新版本 v0.2.429")
    expect(onStateChanged).toHaveBeenCalledTimes(1)

    act(() => {
      emitState?.(updateState)
    })
    await act(async () => {
      document.querySelector("button")?.click()
      await Promise.resolve()
    })
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
    expect(installUpdate).not.toHaveBeenCalled()
  })

  it("shows download text and progress in the app shell footer", async () => {
    getState.mockResolvedValue({
      ...baseState,
      releaseVersion: "0.2.429",
      status: "downloading",
      message: "正在下载更新...",
      downloadPercent: 42.4,
    })
    subscribeAndRender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("正在下载 v0.2.429")
    expect(document.body.textContent).toContain("42%")
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42.4")
    expect(document.querySelector("button")).toBeNull()
  })

  it("installs and restarts from the downloaded update button", async () => {
    getState.mockResolvedValue({
      ...baseState,
      releaseVersion: "0.2.429",
      status: "downloaded",
      message: "新版本 v0.2.429 已下载。",
      downloadPercent: 100,
    })
    subscribeAndRender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("安装并重启")
    await act(async () => {
      document.querySelector("button")?.click()
      await Promise.resolve()
    })
    expect(installUpdate).toHaveBeenCalledTimes(1)
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it("stays hidden when no update is available", async () => {
    subscribeAndRender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.querySelector("button")).toBeNull()
  })
})

function subscribeAndRender(): ((state: SynapseAppUpdateState) => void) | undefined {
  let listener: ((state: SynapseAppUpdateState) => void) | undefined
  onStateChanged.mockImplementationOnce((nextListener) => {
    listener = nextListener
    return () => undefined
  })
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<AppShellUpdateIndicator />)
  })
  return listener
}
