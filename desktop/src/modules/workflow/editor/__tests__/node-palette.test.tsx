/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import "../../../../../workflow-nodes/register.renderer"
import { NodePalette } from "../node-palette"

describe("NodePalette", () => {
  it("does not offer the removed workflow file conversion node", () => {
    const html = renderToStaticMarkup(<NodePalette />)

    expect(html).toContain("Prompt")
    expect(html).toContain("生成 Word 文档")
    expect(html).not.toContain("文件转换")
  })
})
