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

  it("preserves sanitized Mermaid fences for client-side diagram rendering", async () => {
    const result = await renderDriveMarkdownFragment([
      "```mermaid",
      "flowchart TB",
      "    A[<Start>] --> B[Done]",
      "```",
    ].join("\n"))

    expect(result.html).toContain('<code class="language-mermaid"')
    expect(result.html).toContain("flowchart TB")
    expect(result.html).toContain("A[&#x3C;Start>] --> B[Done]")
    expect(result.html).not.toContain("<Start>")
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

  it("renders safe HTML break tags inside table cells while escaping other raw HTML", async () => {
    const result = await renderDriveMarkdownFragment([
      "| 摘要 | 会计分录 |",
      "| --- | --- |",
      "| 计提工资 | 借：管理费用<br>贷：应付职工薪酬 |",
      "| 发放工资 | 借：应付职工薪酬<br/>贷：银行存款 |",
      "| 备注 | 第一行<br />第二行 <em>保持转义</em> |",
      "",
      "表外<br>保持转义",
    ].join("\n"))

    expect(result.html).toMatch(/借：管理费用<br[^>]*>\s*贷：应付职工薪酬/u)
    expect(result.html).toMatch(/借：应付职工薪酬<br[^>]*>\s*贷：银行存款/u)
    expect(result.html).toMatch(/第一行<br[^>]*>\s*第二行 &#x3C;em>保持转义&#x3C;\/em>/u)
    expect(result.html).toContain("表外&#x3C;br>保持转义")
    expect(result.renderedText).toContain("借：管理费用\n贷：应付职工薪酬")
    expect(result.projection.segments.filter((segment) => segment.mapping === "generated")).toHaveLength(3)
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

  it("opens complete web urls in a new browser context", async () => {
    const result = await renderDriveMarkdownFragment([
      "https://example.com/plain",
      "",
      "[secure](https://example.com/secure)",
      "",
      "[insecure](http://example.com/insecure)",
      "",
      "[heading](#notes)",
      "",
      "[local](./notes.md)",
    ].join("\n"))

    expect(result.html).toContain('<a href="https://example.com/plain" target="_blank" rel="noopener noreferrer">https://example.com/plain</a>')
    expect(result.html).toContain('<a href="https://example.com/secure" target="_blank" rel="noopener noreferrer">secure</a>')
    expect(result.html).toContain('<a href="http://example.com/insecure" target="_blank" rel="noopener noreferrer">insecure</a>')
    expect(result.html).toContain('<a href="#notes">heading</a>')
    expect(result.html).toContain('<a>local</a>')
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

  it("renders resolved explicit Windows image paths after remark encodes their separators", async () => {
    const inlineSource = String.raw`.\image\订单\inline.png?version=1#preview`
    const referenceSource = String.raw`..\assets\reference.jpg`
    const rawSource = String.raw`.\image\raw.webp`
    const missingSource = String.raw`.\image\missing.png`
    const markdown = [
      `![inline](${inlineSource})`,
      "",
      "![reference][diagram]",
      "",
      `[diagram]: ${referenceSource} "Diagram"`,
      "",
      `<img src="${rawSource}" alt="Raw">`,
      "",
      `![missing](${missingSource})`,
    ].join("\n")

    const result = await renderDriveMarkdownFragment(markdown, {
      allowStandaloneRawImages: true,
      relativeImageUrls: new Map([
        [inlineSource, "/drive/items/inline/download?version=1#preview"],
        [referenceSource, "/drive/items/reference/download"],
        [rawSource, "/drive/items/raw/download"],
        [missingSource, null],
      ]),
    })

    expect(result.html).toContain('src="/drive/items/inline/download?version=1#preview"')
    expect(result.html).toContain('src="/drive/items/reference/download"')
    expect(result.html).toContain('src="/drive/items/raw/download"')
    expect(result.html).toContain(`data-drive-markdown-relative-src="${inlineSource}"`)
    expect(result.html).toContain(`data-drive-markdown-relative-src="${referenceSource}"`)
    expect(result.html).toContain(`data-drive-markdown-relative-src="${rawSource}"`)
    expect(result.html).toMatch(/<img(?=[^>]*alt="missing")(?=[^>]*data-drive-markdown-relative-src="\.\\image\\missing\.png")(?![^>]*\ssrc=)[^>]*>/u)
    expect(result.html).not.toContain("%5C")
  })

  it("renders every documented CommonMark relative image form", async () => {
    const result = await renderDriveMarkdownFragment([
      '![plain](./images/plain.png "Plain")',
      "![angle](<./images/angle photo.png>)",
      "![encoded](./images/encoded%20photo.webp)",
      "![reference][diagram]",
      "",
      '[diagram]: <../assets/reference image.jpg> "Reference"',
    ].join("\n"), {
      relativeImageUrls: new Map([
        ["./images/plain.png", "/drive/items/plain/download"],
        ["./images/angle photo.png", "/drive/items/angle/download"],
        ["./images/encoded%20photo.webp", "/drive/items/encoded/download"],
        ["../assets/reference image.jpg", "/drive/items/reference/download"],
      ]),
    })

    expect(result.html).toMatch(/<img[^>]*src="\/drive\/items\/plain\/download"[^>]*alt="plain"[^>]*title="Plain"[^>]*>/u)
    expect(result.html).toMatch(/<img[^>]*src="\/drive\/items\/angle\/download"[^>]*alt="angle"[^>]*>/u)
    expect(result.html).toMatch(/<img[^>]*src="\/drive\/items\/encoded\/download"[^>]*alt="encoded"[^>]*>/u)
    expect(result.html).toMatch(/<img[^>]*src="\/drive\/items\/reference\/download"[^>]*alt="reference"[^>]*title="Reference"[^>]*>/u)
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

  it("omits empty headings from the outline without changing rendered content or projection", async () => {
    const result = await renderDriveMarkdownFragment([
      "# Notes",
      "",
      "#####",
      "",
      "## Details",
      "",
      "#####",
      "",
      "## Summary",
    ].join("\n"))

    expect(result.html).toMatch(/<h5[^>]*id="heading-2"[^>]*><\/h5>/u)
    expect(result.html).toMatch(/<h5[^>]*id="heading-4"[^>]*><\/h5>/u)
    expect(result.html).toMatch(/<h2[^>]*id="details"[^>]*>Details<\/h2>/u)
    expect(result.html).toMatch(/<h2[^>]*id="summary"[^>]*>Summary<\/h2>/u)
    expect(result.renderedText).toBe("NotesDetailsSummary")
    expect(result.projection.blocks.filter((block) => block.type === "heading")).toHaveLength(5)
    expect(result.projection.blocks.filter((block) => block.type === "heading" && block.renderedStart === block.renderedEnd)).toHaveLength(2)
    expect(result.outline).toEqual([
      {
        id: "notes",
        text: "Notes",
        depth: 1,
        children: [
          {
            id: "details",
            text: "Details",
            depth: 2,
            children: [],
          },
          {
            id: "summary",
            text: "Summary",
            depth: 2,
            children: [],
          },
        ],
      },
    ])
  })
})
