import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { TeamsPage } from "./teams-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listTeams: vi.fn(),
  },
}))

describe("TeamsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("loads the next teams page", async () => {
    vi.mocked(adminApi.listTeams)
      .mockResolvedValueOnce({
        data: [
          {
            id: "team-1",
            name: "一组",
            createdByUser: { email: "owner@example.com" },
            memberships: [],
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "team-2",
            name: "二组",
            createdByUser: { email: "owner@example.com" },
            memberships: [],
            createdAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      })

    const result = await render(<TeamsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("一组")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listTeams).toHaveBeenLastCalledWith({ page: 2 })
      expect(result.container.textContent).toContain("二组")
    })
  })
})
