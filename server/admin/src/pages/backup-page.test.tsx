import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { BackupPage } from "./backup-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listBackups: vi.fn(),
    triggerBackup: vi.fn(),
  },
}))

describe("BackupPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("clears stale backup rows when a refresh fails", async () => {
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([
        {
          filename: "synapse-backup-old.tar.gz",
          size: 1024,
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ])
      .mockRejectedValueOnce(new Error("COS 不可用"))
    vi.mocked(adminApi.triggerBackup).mockResolvedValue(undefined)

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "立即备份")
      ?.click()

    await waitFor(() => {
      expect(result.container.textContent).toContain("COS 不可用")
      expect(result.container.textContent).not.toContain("synapse-backup-old.tar.gz")
    })
  })
})
