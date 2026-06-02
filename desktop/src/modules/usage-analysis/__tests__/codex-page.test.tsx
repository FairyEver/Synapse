import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CodexUsageAnalysisModule } from "../index"

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

describe("CodexUsageAnalysisModule", () => {
  it("renders the Codex usage analysis shell", () => {
    const html = renderToStaticMarkup(<CodexUsageAnalysisModule />)
    expect(html).toContain("今日")
    expect(html).toContain("刷新")
    expect(html).not.toContain("7 天")
  })

  it("exposes the implemented details view", () => {
    const html = renderToStaticMarkup(<CodexUsageAnalysisModule />)
    expect(html).toContain("明细")
  })
})
