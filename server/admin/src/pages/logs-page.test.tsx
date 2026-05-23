import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { LOG_LEVEL_FILTER_OPTIONS, LogsPage } from "./logs-page"

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
})
