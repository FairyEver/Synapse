// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseAccountState } from "@/types/account"

const accountState = vi.hoisted((): { current: SynapseAccountState } => ({
  current: {
    status: "authenticated",
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

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: accountState.current,
    isLoading: false,
    pendingAction: null,
    startLogin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ warning: vi.fn() }),
}))

import { AccountUserControl } from "../account-user-control"
import { AppShellActions } from "../app-shell-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

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

  it("does not render the top bar account control in packaged builds", () => {
    ;(window as unknown as { synapse?: { isPackaged: boolean } }).synapse = {
      isPackaged: true,
    }

    const container = renderActions()

    expect(container.textContent).not.toContain("Ada")
    expect(container.querySelector("[data-track='account-user-menu']")).toBeNull()
  })
})
