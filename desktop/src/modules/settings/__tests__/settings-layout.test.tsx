/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createDefaultConfig } from "@/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "@/types/config"

const requestedSettingsCategory = vi.hoisted((): { current: string | null } => ({
  current: "quick-inputs",
}))

const updateConfig = vi.fn(async (patch: SynapseConfigPatch) => ({
  ...createDefaultConfig(),
  ...patch,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        quickInputs: [
          {
            id: "quick-1",
            content: "总结当前仓库今天我在所有分支上的所有提交，归纳总结分类，记录为今天的工作日志，只记录和工作相关的功能",
            directSend: true,
          },
        ],
      },
    } satisfies SynapseConfig,
    error: null,
    isReady: true,
    refreshConfig: vi.fn(async () => createDefaultConfig()),
    updateConfig,
    resetKey: 0,
  }),
}))

vi.mock("@/app-shell/navigation", () => ({
  consumeRequestedSettingsCategory: () => requestedSettingsCategory.current,
  subscribeOpenSettingsAccount: () => () => undefined,
  subscribeOpenSettingsAbout: () => () => undefined,
  subscribeOpenSettingsStorage: () => () => undefined,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: vi.fn(async <T,>(task: () => Promise<T>) => task()),
    warning: vi.fn(),
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useRepositoryActions: () => ({
    replaceRepositories: vi.fn(),
  }),
}))

vi.mock("@/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({ sidebar, children }: { readonly sidebar: ReactNode; readonly children: ReactNode }) => (
    <div>
      <aside>{sidebar}</aside>
      <section>{children}</section>
    </div>
  ),
}))

vi.mock("@/modules/settings/components/identity-panel", () => ({
  IdentityPanel: () => <div>本地身份</div>,
}))

vi.mock("@/modules/settings/components/app-reset-panel", () => ({
  AppResetPanel: () => <div>重置应用</div>,
}))

import { SettingsModule } from "@/modules/settings"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  requestedSettingsCategory.current = "quick-inputs"
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

describe("SettingsModule layout", () => {
  it("bounds settings content so long quick inputs cannot widen the panel", async () => {
    const container = await renderSettingsModule()
    const contentRoot = container.querySelector("section > div")

    expect(contentRoot?.className).toContain("min-w-0")
    expect(contentRoot?.className).toContain("max-w-full")
    expect(contentRoot?.className).toContain("overflow-hidden")
  })

  it("hides the account category in packaged builds", async () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = await renderSettingsModule()
    const sidebar = container.querySelector("aside")

    expect(sidebar?.textContent).not.toContain("账号")
    expect(sidebar?.textContent).toContain("基础设置")
  })

  it("falls back to general settings when packaged builds request account settings", async () => {
    requestedSettingsCategory.current = "account"
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = await renderSettingsModule()

    expect(container.textContent).toContain("外观")
    expect(container.textContent).not.toContain("登录")
  })

  it("keeps the account category visible outside packaged builds", async () => {
    const container = await renderSettingsModule()
    const sidebar = container.querySelector("aside")

    expect(sidebar?.textContent).toContain("账号")
  })
})

async function renderSettingsModule() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SettingsModule />)
  })

  return container
}
