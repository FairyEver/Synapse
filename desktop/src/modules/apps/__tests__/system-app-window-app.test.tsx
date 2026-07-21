/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { requestOpenContentDetail } from "@/app-shell/content-navigation"
import { SystemAppWindowApp } from "../system-app-window-app"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  openSystemApp: vi.fn(),
}))

vi.mock("@/modules/agent", () => ({
  AgentModule: () => <div>Agent 窗口</div>,
}))

vi.mock("@/modules/automation", () => ({
  AutomationModule: () => <div>自动化窗口</div>,
}))

vi.mock("@/modules/resource-repository", () => ({
  ResourceRepositoryModule: () => <div>资源仓库窗口</div>,
}))

vi.mock("@/modules/database", () => ({
  DatabaseModule: () => <div>数据库窗口</div>,
}))

vi.mock("@/modules/drive", () => ({
  DriveModule: () => <div>云盘窗口</div>,
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

vi.mock("@/modules/settings", () => ({
  SettingsModule: () => <div>设置窗口</div>,
}))

vi.mock("@/modules/workflow", () => ({
  WorkflowModule: () => <div>工作流窗口</div>,
}))

vi.mock("../../../../app-capabilities/agent-personas/renderer", () => ({
  AgentPersonasModule: () => <div>智能体窗口</div>,
}))

vi.mock("../../../../app-capabilities/document-template/renderer", () => ({
  DocumentTemplateModule: () => <div>文档模板窗口</div>,
}))

vi.mock("../../../../app-capabilities/document-text-extractor/renderer", () => ({
  DocumentTextExtractorModule: () => <div>文档文本提取窗口</div>,
}))

vi.mock("../../../../app-capabilities/terminal/renderer", () => ({
  TerminalModule: () => <div>终端窗口</div>,
}))

vi.mock("../../../../app-capabilities/sound-notifier/renderer", () => ({
  SoundNotifierModule: () => <div>Sound Notifier 窗口</div>,
}))

vi.mock("../../../../app-capabilities/secrets/renderer", () => ({
  SecretsModule: () => <div>密钥库窗口</div>,
}))

vi.mock("../../../../app-capabilities/skill-installer/renderer", () => ({
  SkillInstallerModule: () => <div>Skill 安装器窗口</div>,
}))

vi.mock("../../../../app-capabilities/skill-uninstaller/renderer", () => ({
  SkillUninstallerModule: () => <div>Skill 卸载器窗口</div>,
}))

vi.mock("../../../../app-capabilities/synapse-skill/renderer", () => ({
  SynapseSkillModule: () => <div>Synapse Skill 窗口</div>,
}))

vi.mock("../../../../app-capabilities/rule-installer/renderer", () => ({
  RuleInstallerModule: () => <div>Rule 安装器窗口</div>,
}))

vi.mock("../../../../app-capabilities/quick-input/renderer", () => ({
  QuickInputModule: () => <div>快捷输入窗口</div>,
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
      act(() => {
        root.unmount()
      })
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

  it("renders the document text extractor system app", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=document-text-extractor")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("文档文本提取窗口")
  })

  it("renders the secrets system app", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=secrets")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("密钥库窗口")
  })

  it("renders the skill uninstaller system app", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=skill-uninstaller")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("Skill 卸载器窗口")
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
