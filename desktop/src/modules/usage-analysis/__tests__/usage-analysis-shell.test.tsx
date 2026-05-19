import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { UsageAnalysisShell } from "../shared/components/usage-analysis-shell"

describe("UsageAnalysisShell", () => {
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
