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
  gitOpenRequestListener: null as null | ((request: { requestId: string; repositoryId: string }) => void),
  terminalOpenRequestListener: null as null | ((request: { requestId: string; sessionId: string }) => void),
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
  GitModule: ({ openRequest }: { openRequest?: { repositoryId: string } | null }) => (
    <div>Git 窗口 {openRequest?.repositoryId}</div>
  ),
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

vi.mock("../../../../app-capabilities/terminal/renderer", () => ({
  TerminalModule: ({ openRequest }: { openRequest?: { sessionId: string } | null }) => (
    <div>终端窗口 {openRequest?.sessionId}</div>
  ),
}))

vi.mock("../../../../app-capabilities/secrets/renderer", () => ({
  SecretsModule: () => <div>密钥库窗口</div>,
}))

vi.mock("../../../../app-capabilities/synapse-skill/renderer", () => ({
  SynapseSkillModule: () => <div>Synapse Skill 窗口</div>,
}))

vi.mock("../../../../app-capabilities/quick-input/renderer", () => ({
  QuickInputModule: () => <div>快捷输入窗口</div>,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    apps: {
      onContentOpenRequest: () => () => undefined,
      onGitOpenRequest: (listener: (request: { requestId: string; repositoryId: string }) => void) => {
        mocks.gitOpenRequestListener = listener
        return () => {
          mocks.gitOpenRequestListener = null
        }
      },
      onTerminalOpenRequest: (listener: (request: { requestId: string; sessionId: string }) => void) => {
        mocks.terminalOpenRequestListener = listener
        return () => {
          mocks.terminalOpenRequestListener = null
        }
      },
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
    mocks.gitOpenRequestListener = null
    mocks.terminalOpenRequestListener = null
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

  it("passes initial and subsequent Terminal session open requests to the Terminal app", async () => {
    const request = encodeURIComponent(JSON.stringify({
      requestId: "request-1",
      sessionId: "session-1",
    }))
    window.history.replaceState({}, "", `/?window=system-app&appId=terminal&terminalOpenRequest=${request}`)
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("终端窗口 session-1")

    await act(async () => {
      mocks.terminalOpenRequestListener?.({ requestId: "request-2", sessionId: "session-2" })
    })
    expect(document.body.textContent).toContain("终端窗口 session-2")
  })

  it("ignores malformed initial Terminal session open requests", async () => {
    const request = encodeURIComponent(JSON.stringify({ requestId: "", sessionId: "session-1" }))
    window.history.replaceState({}, "", `/?window=system-app&appId=terminal&terminalOpenRequest=${request}`)
    await renderSystemAppWindow(roots)

    expect(document.body.textContent).toContain("终端窗口")
    expect(document.body.textContent).not.toContain("session-1")
  })

  it("renders workflow after the main process has authorized its window", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=workflow")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("工作流窗口")
  })

  it("renders the secrets system app", async () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=secrets")
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("密钥库窗口")
  })

  it("passes initial and subsequent Git repository open requests to the Git app", async () => {
    const request = encodeURIComponent(JSON.stringify({
      requestId: "request-1",
      repositoryId: "repository-1",
    }))
    window.history.replaceState({}, "", `/?window=system-app&appId=git&gitOpenRequest=${request}`)
    await renderSystemAppWindow(roots)
    expect(document.body.textContent).toContain("Git 窗口 repository-1")

    await act(async () => {
      mocks.gitOpenRequestListener?.({ requestId: "request-2", repositoryId: "repository-2" })
    })
    expect(document.body.textContent).toContain("Git 窗口 repository-2")
  })

  it("ignores malformed initial Git repository open requests", async () => {
    const request = encodeURIComponent(JSON.stringify({ requestId: "", repositoryId: "repository-1" }))
    window.history.replaceState({}, "", `/?window=system-app&appId=git&gitOpenRequest=${request}`)
    await renderSystemAppWindow(roots)

    expect(document.body.textContent).toContain("Git 窗口")
    expect(document.body.textContent).not.toContain("repository-1")
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
