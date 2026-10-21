import { describe, expect, it } from "vitest"
import { hasUnsafeGeneratedUiResource, normalizeGeneratedUiSource, splitGeneratedUiContent, validateGeneratedUiSource } from "../agent-generated-ui"
import { thirtyDayReportSource } from "./fixtures/generated-ui-report"
import { codeReportSource, reversedTextCodeReportSource } from "./fixtures/generated-ui-code-report"

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

  it("accepts the official openui-lang fence and holds every partial language tag", () => {
    const fence = "```openui-lang"
    for (let index = 1; index <= fence.length; index++) {
      expect(splitGeneratedUiContent(`Before\n${fence.slice(0, index)}`, true)).toEqual([{ kind: "markdown", content: "Before\n" }])
    }
    expect(splitGeneratedUiContent(`${fence}\n${ui}\n\x60\x60\x60`)).toEqual([{ kind: "openui", content: `${ui}\n`, ordinal: 0, complete: true }])
    expect(splitGeneratedUiContent(`\x60\x60\x60\x60md\n${fence}\n${ui}\n\x60\x60\x60\n\x60\x60\x60\x60`).every((part) => part.kind === "markdown")).toBe(true)
  })
})

describe("generated UI execution boundary", () => {
  it("accepts a report that selects between three datasets using reactive expressions", () => {
    expect(validateGeneratedUiSource(codeReportSource)).toBeNull()
  })

  it("still bounds expanded AST work independently of the source byte limit", () => {
    const rows = JSON.stringify(Array.from({ length: 300 }, (_, n) => ({ day: `Day ${n}`, c: 1, a: n, d: 0 })))
    const expanded = codeReportSource.replace(/((?:allRows|srcRows|bizRows) = )\[[^\n]+/g, `$1${rows}`)
    expect(new TextEncoder().encode(expanded).byteLength).toBeLessThan(128 * 1024)
    expect(validateGeneratedUiSource(expanded)).toBe("界面包含不支持的资源或层级。")
  })

  it("accepts an unambiguous reversal of Text's literal variant and value", () => {
    expect(validateGeneratedUiSource(reversedTextCodeReportSource)).toBeNull()
  })

  it("normalizes only literal Text calls without changing quoted examples, comments or bindings", () => {
    expect(normalizeGeneratedUiSource('root = Stack([Text(\'Added\', \'number\', "lines")])')).toBe('root = Stack([Text(\'number\', \'Added\', "lines")])')
    const unchanged = `root = Stack([TextContent("Text('Added', 'text')")])
// Text("Added", "text")
valid = Text("number", "text")
binding = Text($label, "text")
expression = Text("Added", "text" + $suffix)
escaped = Text("Added\\u0020lines", "text")`
    expect(normalizeGeneratedUiSource(unchanged)).toBe(unchanged)
    expect(validateGeneratedUiSource('root = Stack([OverviewCardBlock([OverviewCardItem("id", Text("Added", "invalid"))])])')).toContain("Text.variant")
  })

  it("accepts a 30-day multi-chart report that reuses its dataset across summaries and tables", () => {
    expect(validateGeneratedUiSource(thirtyDayReportSource)).toBeNull()
  })

  it("checks shared subtrees once without skipping deeper paths, cycles or unsafe resources", () => {
    const shared = { rows: Array.from({ length: 1500 }, (_, n) => ({ n })) }
    expect(hasUnsafeGeneratedUiResource({ a: shared, b: shared, c: shared, d: shared })).toBe(false)
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(hasUnsafeGeneratedUiResource(cycle)).toBe(true)
    const leaf = { text: "Safe" }
    const nested = Array.from({ length: 32 }).reduce<unknown>((value) => ({ child: value }), leaf)
    expect(hasUnsafeGeneratedUiResource({ first: leaf, later: nested })).toBe(true)
    const bad = { text: "![image](https://example.com/track.png)" }
    expect(hasUnsafeGeneratedUiResource({ a: bad, b: bad })).toBe(true)
    expect(hasUnsafeGeneratedUiResource(Array.from({ length: 10_001 }, () => ({ text: "Safe" })))).toBe(true)
    expect(hasUnsafeGeneratedUiResource(Array.from({ length: 10_001 }, (_, n) => n))).toBe(true)
  })
  it("renders the actual official component schema", () => {
    expect(validateGeneratedUiSource(ui)).toBeNull()
  })

  it("keeps official parser defaults for invalid optional Stack layout without rejecting the whole report", () => {
    expect(validateGeneratedUiSource('root = Stack([kpiRow])\nkpiRow = Stack([TextContent("14900")], "row", "m", "stretch", true)')).toBeNull()
  })

  it("still rejects invalid data and form parameters and identifies the failing component", () => {
    expect(validateGeneratedUiSource('root = Stack([filter])\nfilter = Select(42, [])')).toContain("Select.name")
    expect(validateGeneratedUiSource('root = Stack([LineChart(["Day"], [Series("Sales", ["bad"])])])')).toEqual(expect.any(String))
    expect(validateGeneratedUiSource('root = Stack([UnknownWidget("x")])')).toEqual(expect.any(String))
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
