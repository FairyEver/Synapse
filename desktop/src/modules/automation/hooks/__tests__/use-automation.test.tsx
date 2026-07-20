/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useAutomationItems } from "../use-automation"
import type { AutomationItem } from "@/types/automation"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const bridge = vi.hoisted(() => ({
  automation: {
    item: {
      list: vi.fn(),
      onChanged: vi.fn(),
    },
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
  bridge.automation.item.list.mockReset()
  bridge.automation.item.onChanged.mockReset()
})

describe("useAutomationItems", () => {
  it("refreshes items when automation emits a change event", async () => {
    const initialItem = createItem({ id: "automation:1", runCount: 0 })
    const updatedItem = createItem({
      id: "automation:1",
      lastRunAt: "2026-06-03T00:10:00.000Z",
      lastStatus: "success",
      runCount: 1,
    })
    let listener: (() => void) | null = null
    const snapshots: Array<ReturnType<typeof useAutomationItems>> = []
    bridge.automation.item.list
      .mockResolvedValueOnce([initialItem])
      .mockResolvedValueOnce([updatedItem])
    bridge.automation.item.onChanged.mockImplementation((nextListener) => {
      listener = nextListener
      return vi.fn()
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe onSnapshot={(state) => snapshots.push(state)} />)
    })

    expect(snapshots.at(-1)?.items).toEqual([initialItem])

    await act(async () => {
      listener?.()
      await Promise.resolve()
    })

    expect(bridge.automation.item.list).toHaveBeenCalledTimes(2)
    expect(snapshots.at(-1)?.items).toEqual([updatedItem])
  })

  it("logs list refresh failures without exposing backend messages", async () => {
    const rawError = "secret automation database failure"
    const snapshots: Array<ReturnType<typeof useAutomationItems>> = []
    bridge.automation.item.list.mockRejectedValue(new Error(rawError))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe onSnapshot={(state) => snapshots.push(state)} />)
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Automation list refresh failed.", {
      action: "listItems",
      boundary: "renderer.automation.list",
      errorType: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain(rawError)
    expect(snapshots.at(-1)?.error).toBe("读取自动化失败")
  })
})

function Probe({ onSnapshot }: { readonly onSnapshot?: (state: ReturnType<typeof useAutomationItems>) => void }) {
  const state = useAutomationItems()
  onSnapshot?.(state)
  return null
}

function createItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    id: "automation:1",
    schemaVersion: 1,
    name: "Daily report",
    enabled: true,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 10, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
    },
    executor: {
      type: "builtin.command",
      config: { command: "echo ok", shell: "posix", timeoutMins: 30 },
    },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    runCount: 0,
    configVersion: 0,
    ...overrides,
  }
}
