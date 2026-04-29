import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, type Account } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { AccountsPage } from "./accounts-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listAccounts: vi.fn(),
  },
}))

describe("AccountsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("filters accounts by email", async () => {
    vi.mocked(adminApi.listAccounts).mockResolvedValue([
      createAccount("account_1", "alpha@example.com"),
      createAccount("account_2", "beta@example.com"),
    ])

    const result = await render(<AccountsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("alpha@example.com")
      expect(result.container.textContent).toContain("beta@example.com")
    })

    const emailSearch = result.container.querySelector("#account-email-search") as HTMLInputElement

    await act(async () => {
      changeInput(emailSearch, "beta")
    })

    await waitFor(() => {
      expect(result.container.textContent).not.toContain("alpha@example.com")
      expect(result.container.textContent).toContain("beta@example.com")
    })
  })
})

function createAccount(id: string, email: string): Account {
  return {
    id,
    email,
    status: "active",
    createdAt: "2026-04-29T00:00:00.000Z",
    licenses: [],
  }
}
