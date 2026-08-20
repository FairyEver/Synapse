/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LiveConnectionPanel } from "../live-connection-panel"

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  retry: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    live: {
      getState: mocks.getState,
      retry: mocks.retry,
      onStateChanged: mocks.subscribe,
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.getState.mockReset()
  mocks.retry.mockReset()
  mocks.subscribe.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("LiveConnectionPanel", () => {
  it("renders the connected live status without a retry action", async () => {
    const state = createLiveState({ status: "connected" })
    mocks.getState.mockResolvedValue(state)

    renderPanel(state)
    await flush()

    expect(document.body.textContent).toContain("服务器连接")
    expect(document.body.textContent).toContain("已连接")
    expect(findButton("立即重试")).toBeUndefined()
  })

  it("renders reconnecting details without marking the whole field invalid", async () => {
    const state = createLiveState({ status: "reconnecting", lastError: "网络不可用" })
    mocks.getState.mockResolvedValue(state)

    renderPanel(state)
    await flush()

    expect(document.body.textContent).toContain("重连中")
    expect(document.body.textContent).toContain("网络不可用")
    expect(document.querySelector("[data-invalid='true']")).toBeNull()
    expect(findButton("立即重试")).toBeTruthy()
  })

  it("retries the live connection from the reconnecting state", async () => {
    const state = createLiveState({ status: "reconnecting", lastError: "连接已断开" })
    mocks.getState.mockResolvedValue(state)
    mocks.retry.mockResolvedValue(createLiveState({ status: "reconnecting", lastError: null }))

    renderPanel(state)
    await flush()
    await clickButton("立即重试")

    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })

  it("offers retry when the connection state cannot be read", async () => {
    const state = createLiveState({ status: "connected" })
    mocks.getState.mockRejectedValue(new Error("state unavailable"))

    renderPanel(state)
    await flush()

    expect(document.body.textContent).toContain("未连接")
    expect(document.body.textContent).toContain("状态读取失败")
    expect(findButton("立即重试")).toBeTruthy()
  })
})

function createLiveState(overrides: Partial<{
  status: "connected" | "reconnecting" | "disconnected" | "unauthenticated"
  lastError: string | null
}> = {}) {
  return {
    status: overrides.status ?? "connected",
    clientInstanceId: "client-a",
    connectedAt: overrides.status === "connected" ? "2026-06-06T10:00:00.000Z" : null,
    lastSeenAt: overrides.status === "connected" ? "2026-06-06T10:00:01.000Z" : null,
    lastError: overrides.lastError ?? null,
  }
}

function renderPanel(initialState: ReturnType<typeof createLiveState>): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(<LiveConnectionPanel initialState={initialState} />))
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === label)
}

async function clickButton(label: string): Promise<void> {
  const button = findButton(label)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
