import { describe, expect, it } from "vitest"
import { renderSkillHubMarkdown, stripSkillMarkdownFrontmatter } from "./skill-hub-markdown"

describe("Skill Hub Markdown rendering", () => {
  it("removes frontmatter before rendering", () => {
    expect(stripSkillMarkdownFrontmatter("\uFEFF---\nname: test\n---\n# 说明\n"))
      .toBe("# 说明\n")
    expect(stripSkillMarkdownFrontmatter("---\nnot frontmatter")).toBe("---\nnot frontmatter")
  })

  it("renders GFM while keeping raw HTML, links and images inactive", async () => {
    const html = await renderSkillHubMarkdown([
      "---",
      "name: test",
      "description: package",
      "---",
      "# 使用说明",
      "",
      "| 名称 | 状态 |",
      "| --- | --- |",
      "| 文件 | 可用 |",
      "",
      "[外部链接](https://example.test)",
      "",
      "![外部图片](https://example.test/pixel.png)",
      "",
      '<script>alert("x")</script>',
      "",
      '<iframe src="https://example.test"></iframe>',
      "",
      "```ts",
      "const value = 1",
      "```",
    ].join("\n"))

    expect(html).toContain("<h1>使用说明</h1>")
    expect(html).toContain("<table>")
    expect(html).toContain('data-skill-markdown-table-scroll="true"')
    expect(html).toContain("<pre><code")
    expect(html).toContain("外部链接")
    expect(html).toContain("外部图片")
    expect(html).not.toContain("description: package")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<a ")
    expect(html).not.toContain("href=")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<iframe")
  })
})
