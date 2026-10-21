import { describe, expect, it } from "vitest"
import { appendGeneratedUiPrompt } from "../generated-ui-prompt"

describe("OpenUI host prompt", () => {
  it("appends to the Claude Code preset without replacing persona instructions", () => {
    const result = appendGeneratedUiPrompt({ type: "preset", preset: "claude_code", append: "Persona instruction" })
    expect(result).toMatchObject({ type: "preset", preset: "claude_code", append: expect.stringContaining("Persona instruction") })
    expect(JSON.stringify(result)).toContain("```openui")
    expect(JSON.stringify(result)).toContain("@ToAssistant")
  })
  it("supports absent, string, array and custom system prompts", () => {
    expect(appendGeneratedUiPrompt(undefined)).toMatchObject({ preset: "claude_code" })
    expect(appendGeneratedUiPrompt("Existing")).toEqual(expect.stringContaining("Existing"))
    expect(appendGeneratedUiPrompt(["Existing"])).toEqual(expect.arrayContaining(["Existing"]))
    expect(appendGeneratedUiPrompt({ type: "custom", prompt: "Existing" })).toMatchObject({ type: "custom", prompt: expect.stringContaining("Existing") })
  })
})
