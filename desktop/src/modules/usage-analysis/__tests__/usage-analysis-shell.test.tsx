import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { UsageAnalysisShell } from "../shared/components/usage-analysis-shell"

describe("UsageAnalysisShell", () => {
  it("shows today before overview", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="today"
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html.indexOf("今日")).toBeGreaterThanOrEqual(0)
    expect(html.indexOf("今日")).toBeLessThan(html.indexOf("概览"))
  })

  it("hides the historical range picker on today", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="today"
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).not.toContain("7 天")
    expect(html).not.toContain("90 天")
    expect(html).toContain("刷新")
  })

  it("shows the historical range picker on overview", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="overview"
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).toContain("7 天")
    expect(html).toContain("90 天")
  })

  it("shows a disabled loading refresh button while refreshing", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="overview"
        range="30d"
        refreshing
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).toContain("disabled=\"\"")
    expect(html).toContain("aria-busy=\"true\"")
    expect(html).toContain("animate-spin")
    expect(html).toContain("刷新中")
  })
})
