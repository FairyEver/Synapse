/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  activeRepository: null as { uuid: string; name: string; localPath: string } | null,
  getStates: vi.fn(),
  getPendingOpenRequest: vi.fn(),
  hasRepositories: false,
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  repositoryState: undefined as { status: "checking" | "missing" | "ready" } | undefined,
  requestOpenSettingsAbout: vi.fn(),
  updateOpenRequestListener: null as null | ((request: { id: number; automatic: boolean }) => void),
  updateOpenRequestSetupOrder: [] as string[],
}))

vi.mock("@/app-shell/account-ui-visibility", () => ({
  isAccountUiVisible: () => false,
}))

vi.mock("@/app-shell/components/app-shell-actions", () => ({
  AppShellActions: () => <div data-testid="app-shell-actions" />,
}))

vi.mock("@/app-shell/components/app-shell-layout", () => ({
  AppShellLayout: ({ dock, children }: {
    dock: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <nav>{dock}</nav>
      <main>{children}</main>
    </div>
  ),
}))

vi.mock("@/app-shell/components/app-shell-dock", () => ({
  AppShellDock: () => <nav>Dock</nav>,
}))

vi.mock("@/app-shell/components/empty-repository-state", () => ({
  EmptyRepositoryState: () => <div data-testid="empty-repository-state" />,
}))

vi.mock("@/app-shell/components/identity-gate", () => ({
  IdentityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/app-shell/identity-context", () => ({
  useCurrentRepoProfile: () => ({ currentRepoProfileState: null }),
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
    config: { global: { dockAppIds: [] } },
    resetKey: "test",
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => mocks.activeRepository,
  useHasRepositories: () => mocks.hasRepositories,
  useRepositoryActions: () => ({ syncRepository: vi.fn() }),
  useRepositoryManager: () => ({ refreshRepositoryStates: vi.fn() }),
  useRepositoryState: () => mocks.repositoryState,
}))

vi.mock("@/app-shell/navigation", () => ({
  publishActiveAppTab: vi.fn(),
  requestOpenSettingsAccount: vi.fn(),
  requestOpenSettingsAbout: mocks.requestOpenSettingsAbout,
  requestOpenSettingsDock: vi.fn(),
  requestOpenSettingsStorage: vi.fn(),
  subscribeOpenAgentSession: () => () => undefined,
  subscribeOpenSettingsTab: () => () => undefined,
}))

vi.mock("@/app-shell/content-navigation", () => ({
  subscribeContentOpenRequest: () => () => undefined,
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

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

vi.mock("@/lib/diagnostic-context", () => ({
  recordDiagnosticBreadcrumb: vi.fn(),
  updateDiagnosticContext: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    agent: {
      onOpenConversation: () => () => undefined,
    },
    cheatCodes: {
      getStates: mocks.getStates,
      onStateChanged: () => () => undefined,
    },
    updater: {
      getPendingOpenRequest: () => {
        mocks.updateOpenRequestSetupOrder.push("pull")
        return mocks.getPendingOpenRequest()
      },
      onOpenRequest: (listener: (request: { id: number; automatic: boolean }) => void) => {
        mocks.updateOpenRequestSetupOrder.push("subscribe")
        mocks.updateOpenRequestListener = listener
        return () => {
          mocks.updateOpenRequestListener = null
        }
      },
      onOpenUpdatePage: () => () => undefined,
    },
  }),
}))

vi.mock("@/modules/apps/components/system-app-content", () => ({
  SystemAppContent: ({ appId }: { appId: string }) => (
    <div>{appId === "agent" ? "对话模块" : appId === "launcher" ? "应用模块" : appId}</div>
  ),
}))
vi.mock("@/modules/settings", () => ({ SettingsModule: () => <div>设置模块</div> }))
vi.mock("@/modules/agent", () => ({ AgentModule: () => <div>对话模块</div> }))
vi.mock("@/modules/drive", () => ({ DriveModule: () => <div>云盘模块</div> }))
vi.mock("@/modules/automation", () => ({ AutomationModule: () => <div>自动化模块</div> }))
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
  mocks.activeRepository = null
  mocks.getStates.mockResolvedValue({})
  mocks.getPendingOpenRequest.mockResolvedValue(null)
  mocks.hasRepositories = false
  mocks.repositoryState = undefined
  mocks.updateOpenRequestListener = null
  mocks.updateOpenRequestSetupOrder = []
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

describe("App without repositories", () => {
  it("opens the main shell on the Agent tab instead of the repository setup gate", async () => {
    await renderApp()

    expect(document.querySelector("[data-testid='empty-repository-state']")).toBeNull()
    expect(document.body.textContent).toContain("对话模块")
  })

  it("keeps the main shell visible when the active repository is missing", async () => {
    mocks.activeRepository = {
      uuid: "repo-missing",
      name: "Missing Repo",
      localPath: "/missing/repo",
    }
    mocks.hasRepositories = true
    mocks.repositoryState = { status: "missing" }

    await renderApp()

    expect(document.querySelector("[data-testid='empty-repository-state']")).toBeNull()
    expect(document.body.textContent).toContain("Dock")
    expect(document.body.textContent).toContain("应用模块")
  })

  it("subscribes before pulling a pending update open request and navigates to About Synapse", async () => {
    mocks.getPendingOpenRequest.mockResolvedValue({ id: 1, automatic: true })

    await renderApp()

    expect(mocks.updateOpenRequestSetupOrder.slice(0, 2)).toEqual(["subscribe", "pull"])
    expect(mocks.requestOpenSettingsAbout).toHaveBeenCalledTimes(1)
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "Update open request navigated to About Synapse.",
      { automatic: true, requestId: 1 },
    )
    expect(document.body.textContent).toContain("settings")
  })

  it("ignores an older pull result after a newer update open event", async () => {
    let resolvePending: ((request: { id: number; automatic: boolean }) => void) | undefined
    mocks.getPendingOpenRequest.mockReturnValue(new Promise((resolve) => {
      resolvePending = resolve
    }))

    await renderApp()
    await act(async () => {
      mocks.updateOpenRequestListener?.({ id: 2, automatic: true })
      resolvePending?.({ id: 1, automatic: false })
      await Promise.resolve()
    })

    expect(mocks.requestOpenSettingsAbout).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("settings")
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
