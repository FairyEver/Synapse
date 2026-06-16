import { describe, expect, it } from "vitest"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

describe("drive markdown renderer", () => {
  it("renders a sanitized markdown fragment for browser previews", async () => {
    const html = await renderDriveMarkdownFragment([
      "# Notes",
      "",
      "| Item | Done |",
      "| --- | --- |",
      "| Spec | yes |",
      "",
      "<script>alert(1)</script>",
      "",
      '<img src="x" onerror="alert(1)">',
      "",
      "- [x] reviewed",
      "",
      "```ts",
      "const ok = true",
      "```",
    ].join("\n"))

    expect(html).toContain("<h1>Notes</h1>")
    expect(html).toContain("<table>")
    expect(html).toContain('type="checkbox"')
    expect(html).toContain("<code")
    expect(html).not.toContain("<!doctype html>")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("onerror")
    expect(html).toContain("script>alert(1)")
  })

  it("removes relative resource urls from markdown previews", async () => {
    const html = await renderDriveMarkdownFragment([
      "# Notes",
      "",
      "![diagram](./diagram.png)",
      "",
      "[local doc](../guide.md)",
      "",
      "[external](https://example.com/guide)",
    ].join("\n"))

    expect(html).not.toContain("./diagram.png")
    expect(html).not.toContain("../guide.md")
    expect(html).toContain('<a href="https://example.com/guide">external</a>')
  })
})
