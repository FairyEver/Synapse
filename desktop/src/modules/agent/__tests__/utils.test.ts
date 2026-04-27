import { describe, expect, it } from "vitest"

import { agentCliLabel, thinkingIndicatorText } from "../utils"

describe("agent utils", () => {
  it("cycles the waiting indicator text through three middle dots", () => {
    expect([0, 1, 2, 3, 4, 5].map(thinkingIndicatorText)).toEqual([
      "thinking",
      "thinking·",
      "thinking··",
      "thinking···",
      "thinking",
      "thinking·",
    ])
  })

  it("formats agent cli names for compact display", () => {
    expect(agentCliLabel("codex")).toBe("codex")
    expect(agentCliLabel("claude-code")).toBe("claudecode")
    expect(agentCliLabel(undefined)).toBeUndefined()
  })
})
