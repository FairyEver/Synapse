import { describe, expect, it } from "vitest"
import { renderDriveMarkdownDocument, renderDriveMarkdownFragment } from "./drive-markdown-renderer"

describe("drive markdown renderer", () => {
  it("renders github flavored markdown into a complete document", async () => {
    const html = await renderDriveMarkdownDocument({
      title: "notes.md",
      markdown: [
        "# Notes",
        "",
        "| Item | Done |",
        "| --- | --- |",
        "| Spec | yes |",
        "",
        "- [x] reviewed",
        "",
        "```ts",
        "const ok = true",
        "```",
      ].join("\n"),
    })

    expect(html).toContain("<!doctype html>")
    expect(html).toContain("<title>notes.md</title>")
    expect(html).toContain('<article class="markdown-body">')
    expect(html).toContain("<h1>Notes</h1>")
    expect(html).toContain("<table>")
    expect(html).toContain('type="checkbox"')
    expect(html).toContain("<code")
  })

  it("sanitizes dangerous markdown html", async () => {
    const html = await renderDriveMarkdownDocument({
      title: "unsafe.md",
      markdown: [
        "# Unsafe",
        "",
        "<script>alert(1)</script>",
        "",
        '<img src="x" onerror="alert(1)">',
      ].join("\n"),
    })

    expect(html).not.toContain("<script>")
    expect(html).not.toContain("onerror")
    expect(html).toContain("script>alert(1)")
  })

  it("escapes the document title", async () => {
    const html = await renderDriveMarkdownDocument({
      title: 'bad " <title>.md',
      markdown: "# Safe",
    })

    expect(html).toContain("<title>bad &quot; &lt;title&gt;.md</title>")
  })

  it("renders a sanitized markdown fragment for browser previews", async () => {
    const html = await renderDriveMarkdownFragment([
      "# Notes",
      "",
      "<script>alert(1)</script>",
      "",
      "- [x] reviewed",
    ].join("\n"))

    expect(html).toContain("<h1>Notes</h1>")
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain("<!doctype html>")
    expect(html).not.toContain("<script>")
  })
})
