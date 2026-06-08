// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseAccountState } from "@/types/account"

function createAuthenticatedState(): SynapseAccountState {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
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
        displayName: "Ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  },
}))

const accountActions = vi.hoisted(() => ({
  logout: vi.fn(),
  refresh: vi.fn(),
  startLogin: vi.fn(),
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: accountState.current,
    isLoading: false,
    pendingAction: null,
    startLogin: accountActions.startLogin,
    refresh: accountActions.refresh,
    logout: accountActions.logout,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ warning: vi.fn() }),
}))

import { AccountUserControl } from "../account-user-control"
import { AppShellActions } from "../app-shell-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  accountState.current = createAuthenticatedState()
  accountActions.startLogin.mockResolvedValue({ status: "authenticating", loginUrl: "https://example.com/login" })
  accountActions.refresh.mockResolvedValue(accountState.current)
  accountActions.logout.mockResolvedValue({ status: "unauthenticated" })
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
  it("shows display name as the panel title and email as detail", () => {
    const container = renderControl("panel")

    expect(container.textContent).toContain("Ada")
    expect(container.textContent).toContain("user@example.com")
  })

  it("falls back to email when display name is empty", () => {
    accountState.current = {
      status: "authenticated",
      connectivity: "online",
      profile: {
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: null,
        },
        teams: [],
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    }

    const container = renderControl("panel")

    expect(container.textContent).toContain("user@example.com")
  })

  it("shows offline account identity and keeps sync available", () => {
    accountState.current = {
      status: "authenticated",
      connectivity: "offline",
      offlineReason: "server_unavailable",
      profile: {
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: "Ada",
        },
        teams: [],
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    }

    const panel = renderControl("panel")

    expect(panel.textContent).toContain("Ada")
    expect(panel.textContent).toContain("离线")
    expect(panel.textContent).toContain("同步")
    expect(panel.textContent).toContain("退出")
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
    expect(accountActions.logout).toHaveBeenCalledTimes(1)

    await act(async () => {
      panel.querySelector("button")?.click()
      await Promise.resolve()
    })
    expect(accountActions.logout).toHaveBeenCalledTimes(2)
  })

  it("renders the top bar account control in packaged builds", () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = renderActions()

    expect(container.textContent).toContain("Ada")
    expect(container.querySelector("button")?.textContent).toContain("Ada")
  })
})
