import { describe, expect, it } from "vitest"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

describe("drive markdown renderer", () => {
  it("renders a sanitized markdown fragment for browser previews", async () => {
    const result = await renderDriveMarkdownFragment([
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

    const html = result.html
    expect(html).toContain('<h1 id="notes">Notes</h1>')
    expect(html).toContain('<div data-drive-markdown-table-scroll="true"><table>')
    expect(html).toContain("</table></div>")
    expect(html).toContain('type="checkbox"')
    expect(html).toContain("<code")
    expect(html).not.toContain("<!doctype html>")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("onerror")
    expect(html).toContain("script>alert(1)")
  })

  it("wraps tables without changing rendered text", async () => {
    const result = await renderDriveMarkdownFragment([
      "| # | 说明 |",
      "| --- | --- |",
      "| 1 | 来自本地计算，不直接对应后台响应数组。 |",
    ].join("\n"))

    const text = result.html.replace(/<[^>]+>/g, "")
    expect(result.html).toContain('data-drive-markdown-table-scroll="true"')
    expect(text).toContain("#")
    expect(text).toContain("说明")
    expect(text).toContain("来自本地计算，不直接对应后台响应数组。")
  })

  it("removes relative resource urls from markdown previews", async () => {
    const result = await renderDriveMarkdownFragment([
      "# Notes",
      "",
      "![diagram](./diagram.png)",
      "",
      "[local doc](../guide.md)",
      "",
      "[external](https://example.com/guide)",
    ].join("\n"))

    const html = result.html
    expect(html).not.toContain("./diagram.png")
    expect(html).not.toContain("../guide.md")
    expect(html).toContain('<a href="https://example.com/guide">external</a>')
  })

  it("extracts a nested heading outline and injects stable heading ids", async () => {
    const result = await renderDriveMarkdownFragment([
      "# Notes!",
      "",
      "## 当前 状态",
      "",
      "### 当前 状态",
      "",
      "## 当前 状态",
      "",
      "#### Deep",
    ].join("\n"))

    expect(result.html).toContain('<h1 id="notes">Notes!</h1>')
    expect(result.html).toContain('<h2 id="当前-状态">当前 状态</h2>')
    expect(result.html).toContain('<h3 id="当前-状态-2">当前 状态</h3>')
    expect(result.html).toContain('<h2 id="当前-状态-3">当前 状态</h2>')
    expect(result.outline).toEqual([
      {
        id: "notes",
        text: "Notes!",
        depth: 1,
        children: [
          {
            id: "当前-状态",
            text: "当前 状态",
            depth: 2,
            children: [
              {
                id: "当前-状态-2",
                text: "当前 状态",
                depth: 3,
                children: [],
              },
            ],
          },
          {
            id: "当前-状态-3",
            text: "当前 状态",
            depth: 2,
            children: [
              {
                id: "deep",
                text: "Deep",
                depth: 4,
                children: [],
              },
            ],
          },
        ],
      },
    ])
  })
})
