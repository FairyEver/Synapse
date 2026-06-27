/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { SystemAppContent } from "../components/system-app-content"

const mocks = vi.hoisted(() => ({
  addDockApp: vi.fn(),
  openSystemApp: vi.fn(async () => undefined),
  removeDockApp: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    apps: {
      openSystemApp: mocks.openSystemApp,
    },
  }),
}))

vi.mock("@/modules/apps/hooks/use-dock-preferences", () => ({
  useDockPreferences: () => ({
    addDockApp: mocks.addDockApp,
    dockAppIds: ["agent", "launcher"],
    removeDockApp: mocks.removeDockApp,
    saving: false,
  }),
}))

vi.mock("@/modules/agent", () => ({
  AgentModule: () => <div>对话内容</div>,
}))

vi.mock("@/modules/automation", () => ({
  AutomationModule: () => <div>自动化内容</div>,
}))

vi.mock("@/modules/database", () => ({
  DatabaseModule: () => <div>数据库内容</div>,
}))

vi.mock("@/modules/drive", () => ({
  DriveModule: () => <div>云盘内容</div>,
}))

vi.mock("@/modules/editor-scan", () => ({
  EditorScanModule: () => <div>IDE 内容</div>,
}))

vi.mock("@/modules/git", () => ({
  GitModule: () => <div>Git 内容</div>,
}))

vi.mock("@/modules/model-price", () => ({
  ModelPriceModule: () => <div>价格内容</div>,
}))

vi.mock("@/modules/resource-repository", () => ({
  ResourceRepositoryModule: ({
    initialContentOpenRequest,
    onInitialContentOpenRequestConsumed,
  }: {
    initialContentOpenRequest?: ContentOpenRequest | null
    onInitialContentOpenRequestConsumed?: (requestId: string) => void
  }) => (
    <div>
      资源仓库内容
      {initialContentOpenRequest ? (
        <button
          type="button"
          onClick={() => onInitialContentOpenRequestConsumed?.(initialContentOpenRequest.requestId)}
        >
          消费内容请求
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock("@/modules/settings", () => ({
  SettingsModule: () => <div>设置内容</div>,
}))

vi.mock("@/modules/usage-analysis", () => ({
  UsageMonitorModule: () => <div>用量内容</div>,
}))

vi.mock("@/modules/workflow", () => ({
  WorkflowModule: () => <div>工作流内容</div>,
}))

vi.mock("../../../../app-capabilities/document-template/renderer", () => ({
  DocumentTemplateModule: () => <div>文档模板内容</div>,
}))

vi.mock("../../../../app-capabilities/skill-installer/renderer", () => ({
  SkillInstallerModule: () => <div>Skill 安装器内容</div>,
}))

vi.mock("../../../../app-capabilities/rule-installer/renderer", () => ({
  RuleInstallerModule: () => <div>Rule 安装器内容</div>,
}))

vi.mock("../../../../app-capabilities/screenshot/renderer", () => ({
  ScreenshotModule: () => <div>截图内容</div>,
}))

vi.mock("../../../../app-capabilities/sound-notifier/renderer", () => ({
  SoundNotifierModule: () => <div>Sound Notifier 内容</div>,
}))

vi.mock("../../../../app-capabilities/terminal/renderer", () => ({
  TerminalModule: () => <div>终端内容</div>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("SystemAppContent launcher", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    mocks.addDockApp.mockClear()
    mocks.openSystemApp.mockClear()
    mocks.removeDockApp.mockClear()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
  })

  it("opens launchable apps in the current window and keeps a new-window path", async () => {
    await renderLauncher(roots)

    expect(findExactButton("应用")).toBeNull()
    expect(findButton("本地数据库")).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      findButton("本地数据库").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("数据库内容")
    expect(findButtonByLabel("返回应用列表")).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      findButtonByLabel("新窗口打开").click()
      await Promise.resolve()
    })

    expect(mocks.openSystemApp).toHaveBeenCalledWith("database")
    expect(document.body.textContent).toContain("本地数据库")
    expect(document.body.textContent).not.toContain("数据库内容")
  })

  it("returns to the launcher list when the launcher reset key changes", async () => {
    const launcher = await renderLauncher(roots)

    await act(async () => {
      findButton("本地数据库").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("数据库内容")

    await launcher.rerender({ launcherResetKey: 1 })

    expect(document.body.textContent).toContain("本地数据库")
    expect(document.body.textContent).not.toContain("数据库内容")
    expect(document.querySelector("button[aria-label='返回应用列表']")).toBeNull()
  })

  it("opens pending resource content requests inside a reachable embedded app shell", async () => {
    const onConsumed = vi.fn()
    await renderLauncher(roots, {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    }, onConsumed)

    expect(document.body.textContent).toContain("资源仓库内容")
    expect(findButtonByLabel("返回应用列表")).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      findButton("消费内容请求").click()
      await Promise.resolve()
    })

    expect(onConsumed).toHaveBeenCalledWith("request-1")
  })
})

async function renderLauncher(
  roots: Root[],
  request: ContentOpenRequest | null = null,
  onConsumed?: (requestId: string) => void,
): Promise<{
  rerender: (options?: { readonly launcherResetKey?: number }) => Promise<void>
}> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  const render = async (options: { readonly launcherResetKey?: number } = {}) => {
    await act(async () => {
      root.render(
        <SystemAppContent
          appId="launcher"
          resourceContentOpenRequest={request}
          onResourceContentOpenRequestConsumed={onConsumed}
          launcherResetKey={options.launcherResetKey}
        />,
      )
      await Promise.resolve()
    })
  }

  await render()

  return {
    rerender: render,
  }
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(label))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findExactButton(label: string): HTMLButtonElement | null {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  return button instanceof HTMLButtonElement ? button : null
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}
