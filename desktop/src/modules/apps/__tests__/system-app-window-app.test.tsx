/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { requestOpenContentDetail } from "@/app-shell/content-navigation"
import { SystemAppWindowApp } from "../system-app-window-app"

const mocks = vi.hoisted(() => ({
  openSystemApp: vi.fn(),
}))

vi.mock("@/modules/resource-repository", () => ({
  ResourceRepositoryModule: () => <div>资源仓库窗口</div>,
}))

vi.mock("@/modules/database", () => ({
  DatabaseModule: () => <div>数据库窗口</div>,
}))

vi.mock("@/modules/editor-scan", () => ({
  EditorScanModule: () => <div>IDE 窗口</div>,
}))

vi.mock("@/modules/git", () => ({
  GitModule: () => <div>Git 窗口</div>,
}))

vi.mock("@/modules/usage-analysis", () => ({
  UsageMonitorModule: () => <div>用量窗口</div>,
}))

vi.mock("@/modules/model-price", () => ({
  ModelPriceModule: () => <div>价格窗口</div>,
}))

vi.mock("../../../../app-capabilities/terminal/renderer", () => ({
  TerminalModule: () => <div>终端窗口</div>,
}))

vi.mock("../../../../app-capabilities/screenshot/renderer", () => ({
  ScreenshotModule: () => <div>截图窗口</div>,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    apps: {
      onContentOpenRequest: () => () => undefined,
      openSystemApp: mocks.openSystemApp,
    },
  }),
}))

describe("SystemAppWindowApp", () => {
  const roots: Root[] = []

  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    document.body.innerHTML = ""
    mocks.openSystemApp.mockReset()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("renders known system apps from the URL", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=database")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("数据库窗口")
  })

  it("renders the terminal system app", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=terminal")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("终端窗口")
  })

  it("renders a short error for unknown app ids", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=missing")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("无法打开应用")
  })

  it("forwards content open requests from non-resource app windows", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=editor-scan")
    await renderSystemAppWindow(roots)

    requestOpenContentDetail({
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    })

    expect(mocks.openSystemApp).toHaveBeenCalledWith("resource-repository", {
      contentOpenRequest: {
        kind: "detail",
        requestId: "request-1",
        contentType: "skill",
        contentId: "skill-1",
      },
    })
  })
})

async function renderSystemAppWindow(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SystemAppWindowApp />)
    await Promise.resolve()
  })
}
