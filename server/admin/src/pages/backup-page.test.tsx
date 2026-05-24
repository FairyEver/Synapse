import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { BackupPage } from "./backup-page"

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise has not been initialized.")
  }
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

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

  it("keeps existing backup rows visible when a refresh fails", async () => {
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([
        {
          filename: "synapse-backup-old.tar.gz",
          size: 1024,
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ])
      .mockRejectedValueOnce(new Error("COS 不可用"))
    vi.mocked(adminApi.triggerBackup).mockResolvedValue({
      filename: "synapse-backup-new.tar.gz",
      size: 2048,
      uploadedAt: "2026-05-23T00:00:00.000Z",
      status: "success",
    })

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
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
  })

  it("keeps backup action busy until the post-backup refresh completes", async () => {
    const refresh = createDeferred<Awaited<ReturnType<typeof adminApi.listBackups>>>()
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(refresh.promise)
    vi.mocked(adminApi.triggerBackup).mockResolvedValue({
      filename: "synapse-backup-new.tar.gz",
      size: 2048,
      uploadedAt: "2026-05-23T00:00:00.000Z",
      status: "success",
    })

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("暂无备份记录")
    })
    const backupButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "立即备份")

    backupButton?.click()

    await waitFor(() => {
      expect(adminApi.triggerBackup).toHaveBeenCalled()
      expect(backupButton?.disabled).toBe(true)
      expect(backupButton?.textContent).toBe("备份中…")
    })
    refresh.resolve([
      {
        filename: "synapse-backup-new.tar.gz",
        size: 2048,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ])

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-new.tar.gz")
      expect(backupButton?.disabled).toBe(false)
      expect(backupButton?.textContent).toBe("立即备份")
    })
  })

  it("shows the successful backup filename after manual backup", async () => {
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          filename: "synapse-backup-new.tar.gz",
          size: 2048,
          createdAt: "2026-05-23T00:00:00.000Z",
        },
      ])
    vi.mocked(adminApi.triggerBackup).mockResolvedValue({
      filename: "synapse-backup-new.tar.gz",
      size: 2048,
      uploadedAt: "2026-05-23T00:00:00.000Z",
      status: "success",
    })

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("暂无备份记录")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "立即备份")
      ?.click()

    await waitFor(() => {
      expect(result.container.textContent).toContain("已备份 synapse-backup-new.tar.gz")
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

  it("shows download failures and keeps the backup row visible", async () => {
    vi.mocked(adminApi.listBackups).mockResolvedValue([
      {
        filename: "synapse-backup-old.tar.gz",
        size: 1024,
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])
    vi.mocked(adminApi.downloadBackup).mockRejectedValue(new Error("文件不存在"))

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='下载备份 synapse-backup-old.tar.gz']")?.click()

    await waitFor(() => {
      expect(result.container.textContent).toContain("文件不存在")
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
  })

  it("disables the download button while downloading a backup", async () => {
    const downloadRequest = createDeferred<void>()
    vi.mocked(adminApi.listBackups).mockResolvedValue([
      {
        filename: "synapse-backup-old.tar.gz",
        size: 1024,
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ])
    vi.mocked(adminApi.downloadBackup).mockReturnValue(downloadRequest.promise)

    const result = await render(<BackupPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("synapse-backup-old.tar.gz")
    })
    const downloadButton = result.container.querySelector<HTMLButtonElement>(
      "[aria-label='下载备份 synapse-backup-old.tar.gz']",
    )

    downloadButton?.click()

    await waitFor(() => {
      expect(downloadButton?.disabled).toBe(true)
      expect(downloadButton?.textContent).toBe("下载中…")
    })
    downloadRequest.resolve(undefined)

    await waitFor(() => {
      expect(downloadButton?.disabled).toBe(false)
      expect(downloadButton?.textContent).toBe("下载")
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
    const deleteRequest = createDeferred<{ ok: true }>()
    const refresh = createDeferred<Awaited<ReturnType<typeof adminApi.listBackups>>>()
    vi.mocked(adminApi.listBackups)
      .mockResolvedValueOnce([
        {
          filename: "synapse-backup-old.tar.gz",
          size: 1024,
          createdAt: "2026-05-22T00:00:00.000Z",
        },
      ])
      .mockReturnValueOnce(refresh.promise)
    vi.mocked(adminApi.deleteBackup).mockReturnValue(deleteRequest.promise)

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
    deleteRequest.resolve({ ok: true })

    await waitFor(() => {
      expect(adminApi.listBackups).toHaveBeenCalledTimes(2)
      expect(deleteButton?.disabled).toBe(true)
      expect(deleteButton?.textContent).toBe("删除中…")
    })
    refresh.resolve([])

    await waitFor(() => {
      expect(result.container.textContent).toContain("暂无备份记录")
    })
  })
})
