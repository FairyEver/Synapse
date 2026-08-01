// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildAccountDashboardHomeUrl } from "@/lib/account-dashboard-url"
import type { SynapseAccountState } from "@/types/account"

function createAuthenticatedState(): Extract<SynapseAccountState, { status: "authenticated" }> {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada",
      },
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  }
}

function createOfflineState(): SynapseAccountState {
  return {
    ...createAuthenticatedState(),
    connectivity: "offline",
    offlineReason: "server_unavailable",
  }
}

const accountState = vi.hoisted((): { current: SynapseAccountState } => ({
  current: {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada",
      },
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  },
}))

const accountActions = vi.hoisted(() => ({
  cancelLogin: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  startLogin: vi.fn(),
}))

const shellBridge = vi.hoisted(() => ({
  openExternal: vi.fn(),
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: accountState.current,
    isLoading: false,
    pendingAction: null,
    startLogin: accountActions.startLogin,
    cancelLogin: accountActions.cancelLogin,
    refresh: accountActions.refresh,
    logout: accountActions.logout,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ warning: vi.fn() }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "shell") return shellBridge
    throw new Error(`${domain} bridge not available`)
  },
}))

import { AccountUserControl } from "../account-user-control"
import { AppShellActions } from "../app-shell-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  accountState.current = createAuthenticatedState()
  accountActions.startLogin.mockResolvedValue({ status: "authenticating", loginUrl: "https://example.com/login" })
  accountActions.cancelLogin.mockResolvedValue({ status: "unauthenticated" })
  accountActions.refresh.mockResolvedValue(accountState.current)
  accountActions.logout.mockResolvedValue({ status: "unauthenticated" })
  shellBridge.openExternal.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

function renderControl(variant: "toolbar" | "panel") {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<AccountUserControl variant={variant} />)
  })
  return container
}

function renderActions() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<AppShellActions onOpenAccountSettings={vi.fn()} />)
  })
  return container
}

describe("AccountUserControl", () => {
  it("shows handle as the panel title and email as detail", () => {
    const container = renderControl("panel")

    expect(container.textContent).toContain("ada")
    expect(container.textContent).toContain("user@example.com")
  })

  it("falls back to email when handle is empty", () => {
    accountState.current = {
      status: "authenticated",
      connectivity: "online",
      profile: {
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          handle: "",
        },
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    }

    const container = renderControl("panel")

    expect(container.textContent).toContain("user@example.com")
  })

  it("shows clear recovery actions for an offline account", async () => {
    accountState.current = createOfflineState()

    const panel = renderControl("panel")

    expect(panel.textContent).toContain("ada")
    expect(panel.textContent).toContain("离线")
    expect(panel.textContent).toContain("重试连接")
    expect(panel.textContent).toContain("重新登录")
    expect(panel.textContent).toContain("退出")
    expect(panel.textContent).not.toContain("同步账号")

    const buttons = Array.from(panel.querySelectorAll("button"))
    const buttonNamed = (name: string) => buttons.find((button) => button.textContent?.includes(name))

    await act(async () => {
      buttonNamed("重试连接")?.click()
      await Promise.resolve()
    })
    expect(accountActions.refresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      buttonNamed("重新登录")?.click()
      await Promise.resolve()
    })
    expect(accountActions.startLogin).toHaveBeenCalledTimes(1)

    await act(async () => {
      buttonNamed("退出")?.click()
      await Promise.resolve()
    })
    expect(accountActions.logout).toHaveBeenCalledTimes(1)
  })

  it("shows the same recovery actions in the offline toolbar menu", async () => {
    accountState.current = createOfflineState()
    const toolbar = renderControl("toolbar")

    await act(async () => {
      toolbar.querySelector("button")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("重试连接")
    expect(document.body.textContent).toContain("重新登录")
    expect(document.body.textContent).toContain("退出登录")
    expect(document.body.textContent).not.toContain("同步账号")
  })

  it("hides manual refresh actions for an online account", async () => {
    const panel = renderControl("panel")
    const toolbar = renderControl("toolbar")

    expect(panel.textContent).not.toContain("同步")
    expect(panel.textContent).not.toContain("重试连接")
    expect(panel.textContent).not.toContain("重新登录")

    await act(async () => {
      toolbar.querySelector("button")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("同步账号")
    expect(document.body.textContent).not.toContain("重试连接")
    expect(document.body.textContent).not.toContain("重新登录")
  })

  it("shows cancel controls while waiting for browser authentication", async () => {
    accountState.current = { status: "authenticating", loginUrl: "https://example.com/login" }

    const toolbar = renderControl("toolbar")
    const panel = renderControl("panel")

    expect(toolbar.textContent).toContain("取消")
    expect(toolbar.querySelector("button")?.disabled).toBe(false)
    expect(panel.textContent).toContain("登录中")
    expect(panel.textContent).toContain("正在等待浏览器登录")
    expect(panel.textContent).toContain("取消")
    expect(panel.querySelector("button")?.disabled).toBe(false)

    await act(async () => {
      toolbar.querySelector("button")?.click()
      await Promise.resolve()
    })
    expect(accountActions.cancelLogin).toHaveBeenCalledTimes(1)
    expect(accountActions.logout).not.toHaveBeenCalled()

    await act(async () => {
      panel.querySelector("button")?.click()
      await Promise.resolve()
    })
    expect(accountActions.cancelLogin).toHaveBeenCalledTimes(2)
    expect(accountActions.logout).not.toHaveBeenCalled()
  })

  it("renders the top bar account control in packaged builds", () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = renderActions()

    expect(container.textContent).toContain("ada")
    expect(container.querySelector("button")?.textContent).toContain("ada")
  })

  it("opens the user dashboard home from the account summary", async () => {
    const container = renderControl("toolbar")
    const trigger = container.querySelector("button")

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const accountSummary = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
      .find((item) => item.textContent?.includes("ada") && item.textContent.includes("user@example.com"))

    expect(accountSummary).toBeTruthy()

    await act(async () => {
      accountSummary?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
      accountSummary?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))
      accountSummary?.click()
      await Promise.resolve()
    })

    expect(shellBridge.openExternal).toHaveBeenCalledWith(buildAccountDashboardHomeUrl())
  })
})
