import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"

vi.mock("@/lib/api", () => ({
  adminApi: {
    getSession: vi.fn(),
    logout: vi.fn(),
    getSystemOverview: vi.fn(),
    listUsers: vi.fn(),
  },
  userAuthApi: {
    register: vi.fn(),
  },
}))

describe("App", () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    window.location.hash = "#/system"
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
    window.history.pushState({}, "", "/")
  })

  it("centers the header separator with the trigger and title", async () => {
    vi.mocked(adminApi.getSession).mockResolvedValue({ email: "admin@d2.com" })
    vi.mocked(adminApi.getSystemOverview).mockResolvedValue({
      serverTime: "2026-05-21T00:00:00.000Z",
      counts: { auditLogs: 0, users: 0, teams: 0, invitations: 0 },
    })

    const result = await render(<App />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.querySelector("h1")?.textContent).toBe("系统")
    })

    const separator = result.container.querySelector<HTMLElement>(
      'header [data-slot="separator"][data-orientation="vertical"]'
    )

    expect(separator?.className).toContain("data-vertical:self-center")
  })

  it("renders the users route", async () => {
    window.location.hash = "#/users"
    vi.mocked(adminApi.getSession).mockResolvedValue({ email: "admin@d2.com" })
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    const result = await render(<App />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.querySelector("h1")?.textContent).toBe("用户")
    })
  })

  it("renders signup without loading an admin session", async () => {
    window.history.pushState({}, "", "/dashboard/signup?invite=plain-token")

    const result = await render(<App />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("注册账号")
    })
    expect(result.container.querySelector<HTMLInputElement>("#signup-email")).not.toBeNull()
    expect(adminApi.getSession).not.toHaveBeenCalled()
  })
})
