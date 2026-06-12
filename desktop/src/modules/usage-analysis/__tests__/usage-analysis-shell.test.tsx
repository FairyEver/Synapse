import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CC_USAGE_VIEWS, UsageAnalysisShell } from "../shared/components/usage-analysis-shell"

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
    expect(html).toContain("刷新今日")
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

  it("does not show pricing rules in usage pages", () => {
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

    expect(html).not.toContain("价格规则")
  })

  it("shows records tab for CC analysis without separate details and conversation tabs", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="records"
        views={CC_USAGE_VIEWS}
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).toContain("记录")
    expect(html).not.toContain("明细")
    expect(html).not.toContain("对话")
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

  it("keeps today refresh text unchanged while loading", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="today"
        range="30d"
        refreshing
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).toContain("刷新今日")
    expect(html).not.toContain("刷新今日中")
  })

  it("keeps report padding inside the scroll viewport content", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="Codex"
        view="today"
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>report</div>
      </UsageAnalysisShell>,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="relative min-h-0 overflow-hidden min-h-0 flex-1 px-4 py-3"')
    expect(html).toContain('data-slot="scroll-area"')
    expect(html).toContain("min-w-0 max-w-full flex-1")
    expect(html).toContain('data-slot="scroll-area-viewport"')
    expect(html).toContain("focus-visible:outline-1 min-w-0 max-w-full")
    expect(html).toContain('class="min-h-full min-w-full w-0 max-w-full overflow-x-hidden px-2 pb-2 pt-0"')
  })
})
