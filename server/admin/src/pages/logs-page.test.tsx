import { describe, expect, it } from "vitest"
import { LOG_LEVEL_FILTER_OPTIONS } from "./logs-page"

describe("LogsPage", () => {
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
})
