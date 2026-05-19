import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcUsageAnalysisModule } from "../index"

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
  }),
}))

describe("CcUsageAnalysisModule", () => {
  it("renders the CC usage analysis shell", () => {
    const html = renderToStaticMarkup(<CcUsageAnalysisModule />)
    expect(html).toContain("今日")
    expect(html).toContain("刷新")
    expect(html).not.toContain("7 天")
  })
})
