import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { EditorScanModule } from "../index"

vi.mock("../hooks/use-editor-scan", () => ({
  useEditorScan: () => ({
    data: { global: [], projects: [] },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../components/scan-item-detail-dialog", () => ({
  ScanItemDetailDialog: () => null,
}))

describe("EditorScanModule", () => {
  it("shows an empty state when the selected editor scan result is missing", () => {
    const html = renderToStaticMarkup(<EditorScanModule />)

    expect(html).toContain("未找到当前编辑器的扫描数据")
  })
})
