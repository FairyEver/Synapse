import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { appendGeneratedUiPrompt, resolveGeneratedUiReferencePath, fullGeneratedUiReference } from "../generated-ui-prompt"
import { createParser } from "@openuidev/lang-core"
import library from "../../../../src/lib/generated-ui-library.json"

describe("OpenUI host prompt", () => {
  it("appends to the Claude Code preset without replacing persona instructions", () => {
    const result = appendGeneratedUiPrompt({ type: "preset", preset: "claude_code", append: "Persona instruction" })
    expect(result).toMatchObject({ type: "preset", preset: "claude_code", append: expect.stringContaining("Persona instruction") })
    expect(JSON.stringify(result)).toContain("```openui")
    expect(JSON.stringify(result)).toContain("@ToAssistant")
  })
  it("keeps only a short Read bootstrap when a reference is available", () => {
    const result = appendGeneratedUiPrompt({ type: "preset", preset: "claude_code", append: "Persona instruction" }, "/app/OpenUI reference.md") as { append: string }
    expect(result.append).toContain("Persona instruction")
    expect(result.append).toContain("/app/OpenUI reference.md")
    expect(result.append).toContain("Read")
    expect(result.append).toContain("COMPLETE")
    expect(result.append).not.toContain("## Component Signatures")
    expect(result.append.length).toBeLessThan(2400)
  })
  it("falls back when the reference is absent or Read is excluded", async () => {
    expect(await resolveGeneratedUiReferencePath("/missing-openui-reference.md", undefined, [])).toBeUndefined()
    expect(await resolveGeneratedUiReferencePath(__filename, [], [])).toBeUndefined()
    expect(await resolveGeneratedUiReferencePath(__filename, ["Read"], ["Read"])).toBeUndefined()
    expect(await resolveGeneratedUiReferencePath(__filename, ["Read"], [])).toBe(__filename)
  })
  it("ships exactly the current full reference, with no generated library drift", async () => {
    const reference = await fs.readFile(path.resolve(__dirname, "../../../../resources/agent-openui-reference.md"), "utf8")
    expect(reference).toBe(fullGeneratedUiReference() + "\n")
  })
  it("supports absent, string, array and custom system prompts", () => {
    expect(appendGeneratedUiPrompt(undefined)).toMatchObject({ preset: "claude_code" })
    expect(appendGeneratedUiPrompt("Existing")).toEqual(expect.stringContaining("Existing"))
    expect(appendGeneratedUiPrompt(["Existing"])).toEqual(expect.arrayContaining(["Existing"]))
    expect(appendGeneratedUiPrompt({ type: "custom", prompt: "Existing" })).toMatchObject({ type: "custom", prompt: expect.stringContaining("Existing") })
  })
  it("uses self-contained host framing and validates every supplied example against the actual library", () => {
    const result = appendGeneratedUiPrompt(undefined) as { append: string }
    expect(result.append).not.toContain("output ONLY the changed/new statements")
    expect(result.append).not.toContain("root = RootComp")
    const examples = [...result.append.matchAll(/```openui\n([\s\S]*?)```/g)]
    expect(examples.length).toBeGreaterThanOrEqual(2)
    const parser = createParser(library.schema as never, "Stack")
    for (const example of examples) {
      const parsed = parser.parse(example[1])
      expect(parsed.root).not.toBeNull()
      expect(parsed.meta).toMatchObject({ incomplete: false, unresolved: [], orphaned: [], errors: [] })
    }
  })
})
