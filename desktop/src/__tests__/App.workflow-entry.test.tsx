/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"

import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  cheatCodeStateListener: null as null | ((state: { name: string; active: boolean }) => void),
  contentOpenRequestListener: null as null | ((request: ContentOpenRequest) => void),
  getStates: vi.fn(),
  lastDockProps: null as null | {
    apps: Array<{ id: string; name: string }>
    onValueChange: (value: string) => void
  },
  lastSystemAppContentProps: null as null | {
    appId: string
    launcherResetKey?: number
  },
  openSystemApp: vi.fn(async () => undefined),
  updateConfig: vi.fn(async () => undefined),
  currentConfig: {
    global: {
      dockAppIds: ["agent", "drive", "automation", "workflow", "settings", "launcher"],
    },
  },
}))

vi.mock("@/app-shell/components/app-shell-actions", () => ({
  AppShellActions: () => <div data-testid="app-shell-actions" />,
}))

vi.mock("@/app-shell/components/app-shell-layout", () => ({
  AppShellLayout: ({ dock, actions, children }: {
    dock: React.ReactNode
    actions: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <nav>{dock}</nav>
      <div>{actions}</div>
      <main>{children}</main>
    </div>
  ),
}))

vi.mock("@/app-shell/components/app-shell-dock", () => ({
  AppShellDock: (props: {
    apps: Array<{ id: string; name: string }>
    onValueChange: (value: string) => void
  }) => {
    mocks.lastDockProps = props

    return (
      <div>
        {props.apps.map((app) => (
          <button key={app.id} type="button" onClick={() => props.onValueChange(app.id)}>
            {app.name}
          </button>
        ))}
      </div>
    )
  },
}))

vi.mock("@/app-shell/components/empty-repository-state", () => ({
  EmptyRepositoryState: () => <div data-testid="empty-repository-state" />,
}))

vi.mock("@/app-shell/components/identity-gate", () => ({
  IdentityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/app-shell/active-repository-switch", () => ({
  useActiveRepositorySwitch: () => ({
    isSwitchingRepository: false,
    openRepositorySwitchDialog: vi.fn(),
  }),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.currentConfig,
    resetKey: "test",
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => ({ uuid: "repo-1", name: "Repo" }),
  useHasRepositories: () => true,
  useRepositoryActions: () => ({ syncRepository: vi.fn(async () => ({ message: "ok" })) }),
  useRepositoryManager: () => ({ refreshRepositoryStates: vi.fn(async () => undefined) }),
  useRepositoryState: () => ({ status: "ready" }),
}))

vi.mock("@/app-shell/navigation", () => ({
  publishActiveAppTab: vi.fn(),
  requestOpenSettingsAccount: vi.fn(),
  requestOpenSettingsAbout: vi.fn(),
  requestOpenSettingsStorage: vi.fn(),
  subscribeOpenAgentSession: () => () => undefined,
  subscribeOpenSettingsTab: () => () => undefined,
}))

vi.mock("@/app-shell/content-navigation", () => ({
  subscribeContentOpenRequest: (listener: (request: ContentOpenRequest) => void) => {
    mocks.contentOpenRequestListener = listener
    return () => {
      mocks.contentOpenRequestListener = null
    }
  },
}))

vi.mock("@/app-shell/dialog-navigate", () => ({
  ensureBodyInteractable: vi.fn(),
}))

vi.mock("@/app-shell/use-watch-next-agent-session", () => ({
  useWatchNextAgentSession: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/diagnostic-context", () => ({
  updateDiagnosticContext: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    agent: {
      onOpenConversation: () => () => undefined,
    },
    apps: {
      openSystemApp: mocks.openSystemApp,
    },
    cheatCodes: {
      getStates: mocks.getStates,
      onStateChanged: (listener: (state: { name: string; active: boolean }) => void) => {
        mocks.cheatCodeStateListener = listener
        return () => {
          mocks.cheatCodeStateListener = null
        }
      },
    },
    updater: {
      onOpenUpdatePage: () => () => undefined,
    },
  }),
}))

vi.mock("@/modules/apps/components/system-app-content", async () => {
  const { useEffect } = await import("react")
  const { useSystemAppHeaderSlot } = await import("@/modules/apps/components/system-app-header-slot")

  return {
    SystemAppContent: ({
      appId,
      launcherResetKey,
      resourceContentOpenRequest,
      onResourceContentOpenRequestConsumed,
    }: {
      appId: string
      launcherResetKey?: number
      resourceContentOpenRequest?: ContentOpenRequest | null
      onResourceContentOpenRequestConsumed?: (requestId: string) => void
    }) => {
      const { setSlot } = useSystemAppHeaderSlot()
      mocks.lastSystemAppContentProps = { appId, launcherResetKey }

      useEffect(() => {
        if (appId !== "settings") return undefined
        setSlot({
          actions: <button type="button">设置操作</button>,
        })
        return () => setSlot(null)
      }, [appId, setSlot])

      return (
        <div>
          {appId === "agent" ? "对话模块" : appId === "launcher" ? "应用模块" : appId === "workflow" ? "工作流模块" : appId}
          {appId === "launcher" ? <span>launcher-reset:{launcherResetKey ?? "none"}</span> : null}
          {resourceContentOpenRequest ? (
            <button
              type="button"
              onClick={() => onResourceContentOpenRequestConsumed?.(resourceContentOpenRequest.requestId)}
            >
              {resourceContentOpenRequest.contentType}:{resourceContentOpenRequest.kind}
            </button>
          ) : null}
        </div>
      )
    },
  }
})
vi.mock("@/modules/settings", () => ({ SettingsModule: () => <div>设置模块</div> }))
vi.mock("@/modules/agent", () => ({ AgentModule: () => <div>对话模块</div> }))
vi.mock("@/modules/automation", () => ({ AutomationModule: () => <div>自动化模块</div> }))
vi.mock("@/modules/drive", () => ({ DriveModule: () => <div>云盘模块</div> }))
vi.mock("@/modules/workflow", () => ({ WorkflowModule: () => <div>工作流模块</div> }))
vi.mock("@/modules/content/components/content-window-page", () => ({
  ContentWindowPage: () => <div>内容窗口</div>,
}))
vi.mock("@/modules/usage-analysis/cc/components/conversation-detail-window-page", () => ({
  CcConversationDetailWindowPage: () => <div>对话窗口</div>,
}))

import App from "@/App"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.cheatCodeStateListener = null
  mocks.contentOpenRequestListener = null
  mocks.lastDockProps = null
  mocks.lastSystemAppContentProps = null
  mocks.currentConfig = {
    global: {
      dockAppIds: ["agent", "drive", "automation", "workflow", "settings", "launcher"],
    },
  }
  mocks.getStates.mockReset()
  mocks.openSystemApp.mockClear()
  mocks.updateConfig.mockReset()
  vi.clearAllMocks()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("App workflow entry visibility", () => {
  it("uses the configured top navigation order while workflow is hidden", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    expect(topNavigationLabels()).toEqual([
      "对话",
      "云盘",
      "自动化",
      "终端",
      "设置",
      "应用",
    ])
  })

  it("opens the Apps module from the top navigation", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    await act(async () => {
      findTopNavigationButton("应用").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("应用模块")
  })

  it("increments the launcher reset key when clicking the active launcher Dock icon", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    await act(async () => {
      findTopNavigationButton("应用").click()
      await Promise.resolve()
    })

    expect(mocks.lastSystemAppContentProps).toMatchObject({
      appId: "launcher",
      launcherResetKey: 0,
    })
    expect(document.body.textContent).toContain("launcher-reset:0")

    await act(async () => {
      findTopNavigationButton("应用").click()
      await Promise.resolve()
    })

    expect(mocks.lastSystemAppContentProps).toMatchObject({
      appId: "launcher",
      launcherResetKey: 1,
    })
    expect(document.body.textContent).toContain("launcher-reset:1")
  })

  it("renders Dock app header slots without launcher controls", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    await act(async () => {
      findTopNavigationButton("设置").click()
      await Promise.resolve()
    })

    expect(document.querySelector("[data-embedded-system-app-header]")?.textContent).toContain("设置操作")
    expect(document.querySelector("button[aria-label='返回应用列表']")).toBeNull()
    expect(document.querySelector("button[aria-label='新窗口打开']")).toBeNull()
  })

  it("places workflow in the configured order when the workflow entry is visible", async () => {
    mocks.getStates.mockResolvedValue({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true })

    await renderApp()

    expect(topNavigationLabels()).toEqual([
      "对话",
      "云盘",
      "自动化",
      "工作流",
      "终端",
      "设置",
      "应用",
    ])
  })

  it("uses the fixed first visible Dock app as the default main view", async () => {
    mocks.currentConfig.global.dockAppIds = ["drive", "agent", "launcher"]
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    expect(document.body.textContent).toContain("对话模块")
    expect(document.body.textContent).not.toContain("drive")
  })

  it("falls back to the fixed first visible Dock app when workflow becomes hidden", async () => {
    mocks.currentConfig.global.dockAppIds = ["workflow", "drive", "launcher"]
    mocks.getStates.mockResolvedValue({ [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true })

    await renderApp()

    await act(async () => {
      mocks.cheatCodeStateListener?.({
        name: WORKFLOW_ENTRY_CHEAT_CODE_NAME,
        active: false,
      })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("对话模块")
    expect(document.body.textContent).not.toContain("工作流模块")
  })

  it("does not expose Dock config mutation handlers", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    expect(mocks.lastDockProps).not.toHaveProperty("onUnpinApp")
    expect(mocks.lastDockProps).not.toHaveProperty("onMoveApp")
    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it("opens resource content requests inside the Apps module", async () => {
    mocks.getStates.mockResolvedValue({})

    await renderApp()

    await act(async () => {
      mocks.contentOpenRequestListener?.({
        kind: "detail",
        requestId: "request-1",
        contentType: "skill",
        contentId: "skill-1",
      })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("应用模块")
    expect(document.body.textContent).toContain("skill:detail")
    expect(mocks.openSystemApp).not.toHaveBeenCalled()
  })

  it("hides the workflow entry when the initial cheat code state read fails after a visibility event", async () => {
    const getStates = createDeferred<Record<string, boolean>>()
    mocks.getStates.mockReturnValue(getStates.promise)

    await renderApp()

    await act(async () => {
      mocks.cheatCodeStateListener?.({
        name: WORKFLOW_ENTRY_CHEAT_CODE_NAME,
        active: true,
      })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("工作流")

    await act(async () => {
      getStates.reject(new Error("state store unavailable"))
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("工作流")
  })
})

async function renderApp(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<App />)
    await Promise.resolve()
  })
}

function topNavigationLabels(): string[] {
  return Array.from(document.querySelectorAll("nav button")).map((button) => button.textContent ?? "")
}

function findTopNavigationButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("nav button"))
    .find((item) => item.textContent === label)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Top navigation button not found: ${label}`)
  }

  return button
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}
