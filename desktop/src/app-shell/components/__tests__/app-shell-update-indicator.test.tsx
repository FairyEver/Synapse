/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseAppUpdateState } from "@/types/update"

const getState = vi.fn<() => Promise<SynapseAppUpdateState>>()
const onStateChanged = vi.fn<(listener: (state: SynapseAppUpdateState) => void) => () => void>()
const onOpen = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    updater: { getState, onStateChanged },
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn: vi.fn() }),
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
  it("shows an available update in the app shell footer", async () => {
    const updateState = {
      ...baseState,
      releaseVersion: "0.2.429",
      status: "available" as const,
      message: "发现新版本 v0.2.429。",
    }
    getState.mockResolvedValue(updateState)
    const emitState = subscribeAndRender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("发现新版本 v0.2.429")
    expect(onStateChanged).toHaveBeenCalledTimes(1)

    act(() => {
      emitState?.(updateState)
    })
    document.querySelector("button")?.click()
    expect(onOpen).toHaveBeenCalledTimes(1)
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
    root.render(<AppShellUpdateIndicator onOpen={onOpen} />)
  })
  return listener
}
