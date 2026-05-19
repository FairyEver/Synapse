import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CodexUsageAnalysisModule } from "../index"

describe("CodexUsageAnalysisModule", () => {
  it("renders the Codex usage analysis shell", () => {
    const html = renderToStaticMarkup(<CodexUsageAnalysisModule />)
    expect(html).toContain("概览")
    expect(html).toContain("模型")
    expect(html).toContain("刷新")
  })
})
