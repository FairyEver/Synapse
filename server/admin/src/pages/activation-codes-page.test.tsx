import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { ActivationCodesPage } from "./activation-codes-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listActivationCodes: vi.fn(),
    createActivationCode: vi.fn(),
    updateActivationCode: vi.fn(),
  },
}))

describe("ActivationCodesPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("renders activation codes returned by the admin api", async () => {
    vi.mocked(adminApi.listActivationCodes).mockResolvedValue([
      {
        id: "code_1",
        status: "active",
        maxDevices: 1,
        expiresAt: null,
        boundAccountId: "account_1",
        redeemedAt: null,
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    ])

    const result = await render(<ActivationCodesPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("account_1")
      expect(result.container.textContent).toContain("启用")
    })
  })
})
