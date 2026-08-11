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
    expect(html).toMatch(/<h1[^>]*id="notes"[^>]*>Notes<\/h1>/u)
    expect(html).toMatch(/<div data-drive-markdown-table-scroll="true"><table[^>]*>/u)
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
    expect(html).not.toMatch(/<img[^>]*\ssrc="\.\/diagram\.png"/u)
    expect(html).toContain('data-drive-markdown-relative-src="./diagram.png"')
    expect(html).not.toContain("../guide.md")
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com\/guide"[^>]*>external<\/a>/u)
  })

  it("renders resolved Markdown and standalone raw images without changing other relative links", async () => {
    const result = await renderDriveMarkdownFragment([
      "![diagram](./diagram.png)",
      "",
      "![missing](./missing.png)",
      "",
      '[ref]: ../assets/ref.png "Reference"',
      "![reference][ref]",
      "",
      '<img src="images/raw.png" alt="Raw" width="320" height="180" loading="lazy" class="drop" srcset="drop">',
      "",
      "[local doc](../guide.md)",
      "",
      "![public](/files/asset_123)",
    ].join("\n"), {
      allowStandaloneRawImages: true,
      relativeImageUrls: new Map([
        ["./diagram.png", "/share/share_1/items/image_1/download"],
        ["./missing.png", null],
        ["../assets/ref.png", "/share/share_1/items/image_2/download"],
        ["images/raw.png", "/share/share_1/items/image_3/download"],
      ]),
    })

    expect(result.html).toMatch(/<img[^>]*src="\/share\/share_1\/items\/image_1\/download"[^>]*alt="diagram"[^>]*>/u)
    expect(result.html).toMatch(/<img[^>]*alt="missing"[^>]*>/u)
    expect(result.html).toMatch(/<img[^>]*src="\/share\/share_1\/items\/image_2\/download"[^>]*alt="reference"[^>]*title="Reference"[^>]*>/u)
    expect(result.html).toContain('src="/share/share_1/items/image_3/download"')
    expect(result.html).toContain('data-drive-markdown-relative-src="images/raw.png"')
    expect(result.html).toContain('alt="Raw"')
    expect(result.html).toContain('width="320"')
    expect(result.html).toContain('height="180"')
    expect(result.html).toContain('loading="lazy"')
    expect(result.html).not.toContain("class=")
    expect(result.html).not.toContain("srcset=")
    expect(result.html).not.toContain("../guide.md")
    expect(result.html).toContain('src="/files/asset_123"')
  })

  it("matches resolved image URLs after remark encodes Unicode path segments", async () => {
    const result = await renderDriveMarkdownFragment([
      "![unicode](./中文图片.png)",
      "",
      "![space](<./名称 含空格.png>)",
    ].join("\n"), {
      relativeImageUrls: new Map([
        ["./中文图片.png", "/share/share_1/items/unicode/download"],
        ["./名称 含空格.png", "/share/share_1/items/space/download"],
      ]),
    })

    expect(result.html).toContain('src="/share/share_1/items/unicode/download"')
    expect(result.html).toContain('src="/share/share_1/items/space/download"')
  })

  it("renders a safe inline relative image whose path contains unescaped spaces", async () => {
    const result = await renderDriveMarkdownFragment("before ![space](./images/team photo.png) after", {
      relativeImageUrls: new Map([
        ["./images/team photo.png", "/drive/items/image-space/download"],
      ]),
    })

    expect(result.html).toContain('src="/drive/items/image-space/download"')
    expect(result.html).toContain('data-drive-markdown-relative-src="./images/team%20photo.png"')
    expect(result.html).toContain('alt="space"')
    expect(result.renderedText).toBe("before space after")
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

    expect(result.html).toMatch(/<h1[^>]*id="notes"[^>]*>Notes!<\/h1>/u)
    expect(result.html).toMatch(/<h2[^>]*id="当前-状态"[^>]*>当前 状态<\/h2>/u)
    expect(result.html).toMatch(/<h3[^>]*id="当前-状态-2"[^>]*>当前 状态<\/h3>/u)
    expect(result.html).toMatch(/<h2[^>]*id="当前-状态-3"[^>]*>当前 状态<\/h2>/u)
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
