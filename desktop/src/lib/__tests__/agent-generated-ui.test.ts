import { describe, expect, it } from "vitest"
import { splitGeneratedUiContent, validateGeneratedUiSource } from "../agent-generated-ui"

const ui = 'root = Stack([TextContent("Hello")])'

describe("generated UI message protocol", () => {
  it("preserves prose and multiple UI blocks in order", () => {
    const parts = splitGeneratedUiContent(`Before\n\n\`\`\`openui\n${ui}\n\`\`\`\nAfter\n\`\`\`openui\n${ui}\n\`\`\``)
    expect(parts.map((part) => part.kind)).toEqual(["markdown", "openui", "markdown", "openui"])
    expect(parts.filter((part) => part.kind === "openui").map((part) => part.ordinal)).toEqual([0, 1])
  })

  it("does not interpret ordinary, nested or quoted code fences", () => {
    for (const source of [`\`\`\`ts\n${ui}\n\`\`\``, `\`\`\`\`md\n\`\`\`openui\n${ui}\n\`\`\`\n\`\`\`\``, `> \`\`\`openui\n> ${ui}\n> \`\`\``]) {
      expect(splitGeneratedUiContent(source).every((part) => part.kind === "markdown")).toBe(true)
    }
  })

  it("holds a partial fence and previews an unfinished UI without inventing completion", () => {
    expect(splitGeneratedUiContent("text\n```ope", true)).toEqual([{ kind: "markdown", content: "text\n" }])
    expect(splitGeneratedUiContent(`\`\`\`openui\n${ui}`, true)[0]).toMatchObject({ kind: "openui", complete: false, ordinal: 0 })
    expect(splitGeneratedUiContent(`\`\`\`openui\n${ui}`)[0]).toMatchObject({ kind: "openui", complete: false })
  })

  it("supports every stream split without changing the final content", () => {
    const source = `Text\n\`\`\`openui\n${ui}\n\`\`\``
    for (let index = 0; index <= source.length; index++) {
      expect(() => splitGeneratedUiContent(source.slice(0, index), true)).not.toThrow()
    }
    expect(splitGeneratedUiContent(source).find((part) => part.kind === "openui")?.content.trim()).toBe(ui)
  })
})

describe("generated UI execution boundary", () => {
  it("renders the actual official component schema", () => {
    expect(validateGeneratedUiSource(ui)).toBeNull()
  })

  it.each([
    'root = Stack([x])\nx = Query("read", {})',
    'root = Stack([])\nx = Mutation("write", {})',
    'root = Stack([Button("Go", @Run(x))])',
    'root = UnknownWidget("x")',
    'root = Stack([Image("https://example.com/track.png")])',
    'root = Stack([Modal("x")])',
    'root = Stack([MarkDownRenderer("![x](https://example.com/track.png)")])',
    'root = Stack([TextContent("![x](https://example.com/track.png)")])',
    'root = Stack([Image("https://" + "example.com/track.png")])',
    'root = $show ? Image("https://example.com/track.png") : Stack([])',
    'root = Stack([root])',
  ])("rejects unsafe or invalid source: %s", (source) => {
    expect(validateGeneratedUiSource(source)).toEqual(expect.any(String))
  })

  it("does not mistake literal content for executable tools", () => {
    expect(validateGeneratedUiSource('root = Stack([TextContent("Query( and @Run are text")])')).toBeNull()
  })

  it("bounds UI parsing without modifying the original response", () => {
    expect(validateGeneratedUiSource(`root = Stack([TextContent("${"x".repeat(128 * 1024)}")])`)).toEqual(expect.any(String))
  })
})
