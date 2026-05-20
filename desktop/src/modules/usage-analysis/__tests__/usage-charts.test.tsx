import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { UsageTrendChart } from "../shared/components/usage-charts"

describe("UsageTrendChart", () => {
  it("shows the bucket granularity switch before token mode tabs", () => {
    const html = renderToStaticMarkup(<UsageTrendChart title="Token 趋势" rows={[]} />)

    expect(html).toContain("按天")
    expect(html).toContain("按小时")
    expect(html.indexOf("按小时")).toBeLessThan(html.indexOf("按天"))
    expect(html.indexOf("按天")).toBeLessThan(html.indexOf("全部"))
    expect(html).toContain("新增")
  })
})
