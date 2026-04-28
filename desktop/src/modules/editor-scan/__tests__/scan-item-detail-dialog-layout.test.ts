import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("scan item detail dialog layout", () => {
  it("keeps the preview/source switch outside the dialog header", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const headerStart = source.indexOf("<DialogHeader")
    const headerEnd = source.indexOf("</DialogHeader>", headerStart)
    const headerContent = source.slice(headerStart, headerEnd)

    expect(headerContent).not.toContain("<Tabs")
  })

  it("uses import wording for external scan items", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("导入到仓库")
    expect(source).toContain("查看仓库内容")
    expect(source).toContain("作为新内容导入")
    expect(source).not.toContain("保存到仓库")
    expect(source).not.toContain("作为新内容保存")
  })

  it("uses explicit save-as wording for duplicate content names", async () => {
    const source = await readFile(
      new URL("../../content/components/content-create-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("名称已存在")
    expect(source).toContain("当前仓库已有同名内容。")
    expect(source).toContain("另存为新内容")
    expect(source).not.toContain("名称重复")
    expect(source).not.toContain("继续保存")
  })

  it("offers editor copy from scan item details", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("复制到编辑器")
    expect(source).toContain("<EditorCopyDialog")
  })

  it("uses copy wording for editor copy", async () => {
    const source = await readFile(
      new URL("../components/editor-copy-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditorWriteTargetSelector")
    expect(source).toContain("copyToEditor")
    expect(source).toContain("复制到")
    expect(source).toContain("复制失败。")
    expect(source).toContain("复制后会被替换")
    expect(source).not.toContain("正在安装到")
    expect(source).not.toContain("安装失败。")
  })
})
