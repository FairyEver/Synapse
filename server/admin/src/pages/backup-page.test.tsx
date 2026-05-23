import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { BackupPage } from "./backup-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    deleteBackup: vi.fn(),
    downloadBackup: vi.fn(),
    listBackups: vi.fn(),
    triggerBackup: vi.fn(),
  },
}))

describe("BackupPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.unstubAllGlobals()
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

  it("downloads and deletes backup rows", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([
        {
          filename: "synapse-backup-old.tar.gz",
          size: 1024,
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([])
    vi.mocked(adminApi.deleteBackup).mockResolvedValue({ ok: true })

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='下载备份 synapse-backup-old.tar.gz']")?.click()
    result.container.querySelector<HTMLButtonElement>("[aria-label='删除备份 synapse-backup-old.tar.gz']")?.click()

    await waitFor(() => {
      expect(adminApi.downloadBackup).toHaveBeenCalledWith("synapse-backup-old.tar.gz")
      expect(adminApi.deleteBackup).toHaveBeenCalledWith("synapse-backup-old.tar.gz")
      expect(result.container.textContent).toContain("暂无备份记录")
    })
  })

  it("asks for confirmation before deleting a backup", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(adminApi.listBackups).mockResolvedValue([
      {
        filename: "synapse-backup-old.tar.gz",
        size: 1024,
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='删除备份 synapse-backup-old.tar.gz']")?.click()

    expect(window.confirm).toHaveBeenCalledWith("确定删除备份 synapse-backup-old.tar.gz？")
    expect(adminApi.deleteBackup).not.toHaveBeenCalled()
  })

  it("disables the delete button while deleting a backup", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    let resolveDelete: ((value: { ok: true }) => void) | null = null
    vi.mocked(adminApi.listBackups).mockResolvedValue([
      {
        filename: "synapse-backup-old.tar.gz",
        size: 1024,
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])
    vi.mocked(adminApi.deleteBackup).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve
        }),
    )

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    const deleteButton = result.container.querySelector<HTMLButtonElement>(
      "[aria-label='删除备份 synapse-backup-old.tar.gz']",
    )

    deleteButton?.click()

    await waitFor(() => {
      expect(deleteButton?.disabled).toBe(true)
      expect(deleteButton?.textContent).toBe("删除中…")
    })
    resolveDelete?.({ ok: true })
  })
})
