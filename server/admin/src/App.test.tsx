import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"

vi.mock("@/lib/api", () => ({
  adminApi: {
    getSession: vi.fn(),
    logout: vi.fn(),
    listActivationCodes: vi.fn(),
    createActivationCode: vi.fn(),
    updateActivationCode: vi.fn(),
    archiveActivationCode: vi.fn(),
    listAccounts: vi.fn(),
    getAccount: vi.fn(),
    listDevices: vi.fn(),
    getSystemOverview: vi.fn(),
    updateLicense: vi.fn(),
    updateDevice: vi.fn(),
  },
}))

describe("App", () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    window.location.hash = "#/activation-codes"
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
  })

  it("centers the header separator with the trigger and title", async () => {
    vi.mocked(adminApi.getSession).mockResolvedValue({ email: "admin@example.com" })
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([])

    const result = await render(<App />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.querySelector("h1")?.textContent).toBe("激活码")
    })

    const separator = result.container.querySelector<HTMLElement>(
      'header [data-slot="separator"][data-orientation="vertical"]'
    )

    expect(separator?.className).toContain("data-vertical:self-center")
  })
})
