import { describe, expect, it } from "vitest"
import { applyRuleSection } from "../shared-rule-section"

describe("applyRuleSection", () => {
  it("embeds builtin rule IDs with file-name-safe Markdown markers", () => {
    const content = applyRuleSection("", "builtin__rule__database-shortcut", "Use sss.")

    expect(content).toBe([
      "<!-- synapse-rule:builtin__rule__database-shortcut:begin -->",
      "Use sss.",
      "<!-- synapse-rule:builtin__rule__database-shortcut:end -->",
      "",
    ].join("\n"))
  })
})
