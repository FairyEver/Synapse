import { describe, expect, it } from "vitest"

import {
  applyVariableSubstitutions,
  detectPlaceholders,
} from "../variable-substitution"

describe("variable substitution", () => {
  it("keeps code block placeholders ignored by default", () => {
    const content = "```text\nTOKEN=${{ TOKEN }}\n```"

    expect(detectPlaceholders(content)).toEqual([])
    expect(applyVariableSubstitutions(content, { TOKEN: "secret" })).toBe(content)
  })

  it("can detect and replace placeholders inside code blocks", () => {
    const content = "```text\nTOKEN=${{ TOKEN }}\n```"

    expect(detectPlaceholders(content, { includeCodeBlocks: true })).toEqual(["TOKEN"])
    expect(applyVariableSubstitutions(content, { TOKEN: "secret" }, { includeCodeBlocks: true }))
      .toBe("```text\nTOKEN=secret\n```")
  })

  it("preserves escaped placeholders while replacing active placeholders", () => {
    const content = "TOKEN=${{ TOKEN }}\nEXAMPLE=\\${{ LITERAL }}"

    expect(detectPlaceholders(content, { includeCodeBlocks: true })).toEqual(["TOKEN"])
    expect(applyVariableSubstitutions(content, { TOKEN: "secret" }, { includeCodeBlocks: true }))
      .toBe("TOKEN=secret\nEXAMPLE=\\${{ LITERAL }}")
  })
})
