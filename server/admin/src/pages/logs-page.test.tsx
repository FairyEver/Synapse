import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { LOG_LEVEL_FILTER_OPTIONS, LogsPage } from "./logs-page"

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise has not been initialized.")
  }
  let reject: (reason?: unknown) => void = () => {
    throw new Error("Promise has not been initialized.")
  }
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

vi.mock("@/lib/api", () => ({
  adminApi: {
    cleanupLogs: vi.fn(),
    downloadLogs: vi.fn(),
    fetchRecentLogs: vi.fn(),
    listLogFiles: vi.fn(),
  },
}))

describe("LogsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("offers fatal in the level filter", () => {
    expect(LOG_LEVEL_FILTER_OPTIONS).toEqual([
      { value: "all", label: "全部" },
      { value: "error", label: "Error" },
      { value: "fatal", label: "Fatal" },
      { value: "warn", label: "Warn" },
      { value: "info", label: "Info" },
      { value: "debug", label: "Debug" },
    ])
  })

  it("cleans logs before the selected date after confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.fetchRecentLogs).mockResolvedValue([])
    vi.mocked(adminApi.listLogFiles).mockResolvedValue([])
    vi.mocked(adminApi.cleanupLogs).mockResolvedValue({ deleted: 2 })

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(adminApi.listLogFiles).toHaveBeenCalledTimes(1)
    })
    changeInput(result.container.querySelector<HTMLInputElement>("[aria-label='清理日期']")!, "2026-05-01")
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "清理早于日期")
      ?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("确定清理 2026-05-01 之前的日志？")
      expect(adminApi.cleanupLogs).toHaveBeenCalledWith("2026-05-01")
      expect(adminApi.listLogFiles).toHaveBeenCalledTimes(2)
    })
  })

  it("does not clean logs when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(adminApi.fetchRecentLogs).mockResolvedValue([])
    vi.mocked(adminApi.listLogFiles).mockResolvedValue([])

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(adminApi.listLogFiles).toHaveBeenCalledTimes(1)
    })
    changeInput(result.container.querySelector<HTMLInputElement>("[aria-label='清理日期']")!, "2026-05-01")
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "清理早于日期")
      ?.click()

    expect(adminApi.cleanupLogs).not.toHaveBeenCalled()
  })

  it("keeps recent logs visible when log files fail to load", async () => {
    vi.mocked(adminApi.fetchRecentLogs).mockResolvedValue([{
      time: "2026-05-23T00:00:00.000Z",
      level: "info",
      msg: "request completed",
      req: { method: "GET", url: "/api/admin/logs/recent" },
    }])
    vi.mocked(adminApi.listLogFiles).mockRejectedValue(new Error("文件列表加载失败"))

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("GET /api/admin/logs/recent")
      expect(result.container.textContent).toContain("日志文件加载失败：文件列表加载失败")
    })
  })

  it("keeps log files visible when recent logs fail to load", async () => {
    vi.mocked(adminApi.fetchRecentLogs).mockRejectedValue(new Error("最近日志加载失败"))
    vi.mocked(adminApi.listLogFiles).mockResolvedValue([{
      name: "server.2026-05-23.log",
      size: 2048,
      modifiedAt: "2026-05-23T00:00:00.000Z",
    }])

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("最近日志加载失败：最近日志加载失败")
      expect(result.container.textContent).toContain("server.2026-05-23.log")
    })
  })

  it("keeps the latest refresh results when an older request finishes later", async () => {
    const firstEntries = createDeferred<Awaited<ReturnType<typeof adminApi.fetchRecentLogs>>>()
    const secondEntries = createDeferred<Awaited<ReturnType<typeof adminApi.fetchRecentLogs>>>()
    const firstFiles = createDeferred<Awaited<ReturnType<typeof adminApi.listLogFiles>>>()
    const secondFiles = createDeferred<Awaited<ReturnType<typeof adminApi.listLogFiles>>>()
    vi.mocked(adminApi.fetchRecentLogs)
      .mockReturnValueOnce(firstEntries.promise)
      .mockReturnValueOnce(secondEntries.promise)
    vi.mocked(adminApi.listLogFiles)
      .mockReturnValueOnce(firstFiles.promise)
      .mockReturnValueOnce(secondFiles.promise)

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(adminApi.fetchRecentLogs).toHaveBeenCalledTimes(1)
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((item) => item.textContent === "刷新")
      ?.click()

    await waitFor(() => {
      expect(adminApi.fetchRecentLogs).toHaveBeenCalledTimes(2)
    })
    secondEntries.resolve([{ time: "2026-05-23T00:00:00.000Z", level: "error", msg: "latest" }])
    secondFiles.resolve([{ name: "latest.log", size: 1, modifiedAt: "2026-05-23T00:00:00.000Z" }])

    await waitFor(() => {
      expect(result.container.textContent).toContain("latest")
      expect(result.container.textContent).toContain("latest.log")
    })
    firstEntries.resolve([{ time: "2026-05-22T00:00:00.000Z", level: "info", msg: "stale" }])
    firstFiles.resolve([{ name: "stale.log", size: 1, modifiedAt: "2026-05-22T00:00:00.000Z" }])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.container.textContent).toContain("latest")
    expect(result.container.textContent).not.toContain("stale")
  })

  it("shows download progress and errors", async () => {
    const download = createDeferred<void>()
    vi.mocked(adminApi.fetchRecentLogs).mockResolvedValue([])
    vi.mocked(adminApi.listLogFiles).mockResolvedValue([])
    vi.mocked(adminApi.downloadLogs).mockReturnValue(download.promise)

    const result = await render(<LogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("暂无日志")
    })
    const button = Array.from(result.container.querySelectorAll("button"))
      .find((item) => item.textContent === "下载全部")

    button?.click()

    await waitFor(() => {
      expect(adminApi.downloadLogs).toHaveBeenCalledWith(undefined)
      expect(button?.disabled).toBe(true)
      expect(button?.textContent).toBe("下载中…")
    })
    download.reject(new Error("下载失败"))

    await waitFor(() => {
      expect(result.container.textContent).toContain("下载失败")
      expect(button?.disabled).toBe(false)
      expect(button?.textContent).toBe("下载全部")
    })
  })
})
