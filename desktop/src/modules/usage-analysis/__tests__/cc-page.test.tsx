import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcUsageAnalysisModule } from "../index"

describe("CcUsageAnalysisModule", () => {
  it("renders the CC usage analysis shell", () => {
    const html = renderToStaticMarkup(<CcUsageAnalysisModule />)
    expect(html).toContain("概览")
    expect(html).toContain("时间")
    expect(html).toContain("刷新")
  })
})
