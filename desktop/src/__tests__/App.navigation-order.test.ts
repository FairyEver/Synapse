import { describe, expect, it } from "vitest"
import { APP_NAVIGATION_TABS } from "../../config"

describe("app navigation order", () => {
  it("keeps the primary tabs in the requested left-to-right order", () => {
    expect(APP_NAVIGATION_TABS.slice(0, 7).map((tab) => tab.id)).toEqual([
      "agent",
      "workflow",
      "drive",
      "automation",
      "skill",
      "rule",
      "prompt",
    ])
  })
})
