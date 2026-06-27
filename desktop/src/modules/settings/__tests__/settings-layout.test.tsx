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
  current: "general",
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
      },
    } satisfies SynapseConfig,
    error: null,
    isReady: true,
    refreshConfig: vi.fn(async () => createDefaultConfig()),
    updateConfig,
    resetKey: 0,
  }),
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: { status: "unauthenticated" },
    isLoading: false,
    pendingAction: null,
    startLogin: vi.fn(async () => ({ status: "authenticating", loginUrl: "https://example.com/login" })),
    refresh: vi.fn(async () => ({ status: "unauthenticated" })),
    logout: vi.fn(async () => ({ status: "unauthenticated" })),
  }),
}))

vi.mock("@/app-shell/navigation", () => ({
  consumeRequestedSettingsCategory: () => requestedSettingsCategory.current,
  subscribeOpenSettingsAccount: () => () => undefined,
  subscribeOpenSettingsAbout: () => () => undefined,
  subscribeOpenSettingsDock: () => () => undefined,
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
  requestedSettingsCategory.current = "general"
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

describe("SettingsModule layout", () => {
  it("bounds settings content to the available panel width", async () => {
    const container = await renderSettingsModule()
    const contentRoot = container.querySelector("section > div")

    expect(contentRoot?.className).toContain("min-w-0")
    expect(contentRoot?.className).toContain("max-w-full")
    expect(contentRoot?.className).toContain("overflow-hidden")
  })

  it("keeps the account category visible in packaged builds", async () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = await renderSettingsModule()
    const sidebar = container.querySelector("aside")

    expect(sidebar?.textContent).toContain("账号")
    expect(sidebar?.textContent).toContain("基础设置")
  })

  it("opens account settings when packaged builds request account settings", async () => {
    requestedSettingsCategory.current = "account"
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = await renderSettingsModule()

    expect(container.textContent).toContain("账号")
    expect(container.textContent).toContain("登录")
  })

  it("keeps the account category visible outside packaged builds", async () => {
    const container = await renderSettingsModule()
    const sidebar = container.querySelector("aside")

    expect(sidebar?.textContent).toContain("账号")
  })

  it("opens Dock settings when requested", async () => {
    requestedSettingsCategory.current = "dock"

    const container = await renderSettingsModule()

    expect(container.textContent).toContain("Dock 栏")
    expect(container.textContent).toContain("已固定")
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
