import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ReportState } from "../shared/components/report-state"

describe("ReportState", () => {
  it("shows refreshing text when an empty report is refreshing", () => {
    const html = renderToStaticMarkup(
      <ReportState loading={false} error={null} empty refreshing>
        <div>content</div>
      </ReportState>,
    )

    expect(html).toContain("刷新中")
    expect(html).not.toContain("暂无数据")
    expect(html).not.toContain("刷新后查看本机记录。")
  })
})
