import { describe, it, expect, vi } from "vitest"
import { guardedLog } from "../guard"

describe("guardedLog", () => {
  it("forwards log call to logger", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    guardedLog(logger, "warn", "test message", { key: "value" })
    expect(logger.warn).toHaveBeenCalledWith("test message", { key: "value" })
  })

  it("prevents recursive calls", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn().mockImplementation(() => {
        guardedLog(logger, "warn", "recursive call")
      }),
    }
    guardedLog(logger, "error", "original")
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("resets guard after error in logger", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn().mockImplementation(() => {
        throw new Error("logger broke")
      }),
    }
    expect(() => guardedLog(logger, "error", "boom")).not.toThrow()
    guardedLog(logger, "warn", "after reset")
    expect(logger.warn).toHaveBeenCalledWith("after reset", undefined)
  })
})
