/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "@/types/config"
import type { SynapseSystemAppId } from "@/modules/apps/types"
import { DEFAULT_DOCK_APP_IDS } from "@/modules/apps/dock"

const mocks = vi.hoisted(() => ({
  config: null as SynapseConfig | null,
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.notifyError,
    success: mocks.notifySuccess,
  }),
}))

import { useDockPreferences } from "../use-dock-preferences"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DockHarnessState = ReturnType<typeof useDockPreferences>

let roots: Root[] = []
let dockState: DockHarnessState | null = null

function TestDockPreferences() {
  dockState = useDockPreferences({ workflowEntryVisible: false })
  return (
    <div data-dock-app-ids={dockState.dockAppIds.join(",")}>
      {dockState.pinnedApps.map((app) => app.name).join(",")}
    </div>
  )
}

async function renderHookHarness() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TestDockPreferences />)
  })

  return container
}

function setConfigDockAppIds(dockAppIds: SynapseSystemAppId[]) {
  mocks.config = {
    ...createDefaultConfig(),
    global: {
      ...createDefaultConfig().global,
      dockAppIds,
    },
  }
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  dockState = null
  document.body.innerHTML = ""
  vi.clearAllMocks()
  setConfigDockAppIds(["agent", "launcher"])
})

setConfigDockAppIds(["agent", "launcher"])

describe("useDockPreferences", () => {
  it("adds apps before launcher", async () => {
    mocks.updateConfig.mockResolvedValue(createDefaultConfig())
    await renderHookHarness()

    await act(async () => {
      await dockState?.addDockApp("database")
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { dockAppIds: ["agent", "database", "launcher"] },
    } satisfies SynapseConfigPatch)
  })

  it("does not remove launcher", async () => {
    mocks.updateConfig.mockResolvedValue(createDefaultConfig())
    await renderHookHarness()

    await act(async () => {
      await dockState?.removeDockApp("launcher")
    })

    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it("moves apps and restores defaults", async () => {
    setConfigDockAppIds(["agent", "drive", "launcher"])
    mocks.updateConfig.mockResolvedValue(createDefaultConfig())
    await renderHookHarness()

    await act(async () => {
      await dockState?.moveDockApp("drive", "up")
    })
    await act(async () => {
      await dockState?.restoreDefaultDock()
    })

    expect(mocks.updateConfig).toHaveBeenNthCalledWith(1, {
      global: { dockAppIds: ["drive", "agent", "launcher"] },
    } satisfies SynapseConfigPatch)
    expect(mocks.updateConfig).toHaveBeenNthCalledWith(2, {
      global: { dockAppIds: DEFAULT_DOCK_APP_IDS },
    } satisfies SynapseConfigPatch)
  })

  it("rolls back optimistic ids when saving fails", async () => {
    mocks.updateConfig.mockRejectedValue(new Error("config write failed"))
    const container = await renderHookHarness()

    await act(async () => {
      await dockState?.addDockApp("database")
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: { dockAppIds: ["agent", "database", "launcher"] },
    } satisfies SynapseConfigPatch)
    expect(mocks.notifyError).toHaveBeenCalledWith("保存 Dock 设置失败")
    expect(container.querySelector("div")?.dataset.dockAppIds).toBe("agent,launcher")
  })
})
