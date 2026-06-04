# Optional Repository Agent Local Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Synapse open and run Agent conversations without requiring a configured repository, while preserving repository setup flows as reusable UI.

**Architecture:** Add a built-in Agent project (`builtin:default-agent-workspace`) with an app-managed workspace directory under `<userData>/agent-workspaces/default/`. Renderer always includes this project in Agent scope; Electron resolves it into a normal project container. App-level repository onboarding becomes a reusable setup panel instead of a startup gate.

**Tech Stack:** Electron, React, TypeScript, shadcn/Radix components, pnpm, Vitest.

---

## File Structure

- Create `desktop/src/lib/default-agent-workspace.ts`: shared ID, label, and renderer project option for the built-in local Agent workspace.
- Create `desktop/electron/modules/agent/default-agent-workspace.ts`: main-process workspace path resolution and directory creation.
- Modify `desktop/src/App.tsx`: remove app-level repository gate; default no-repository launch to Agent tab.
- Modify `desktop/src/app-shell/components/empty-repository-state.tsx`: turn it into a wrapper around a reusable setup panel.
- Create `desktop/src/app-shell/components/repository-setup-panel.tsx`: move repository choose/create/init/switch UI and logic here.
- Modify `desktop/src/modules/agent/project-resolution.ts`: include the built-in local Agent project in scope.
- Modify `desktop/src/modules/agent/index.tsx`: include the built-in project in sidebar options and selected project lookup.
- Modify `desktop/src/modules/agent/components/agent-session-sidebar.tsx`: remove the “no projects” blocking empty state from normal operation.
- Modify `desktop/electron/modules/agent/ipc-shared.ts`: resolve `builtin:default-agent-workspace`.
- Modify tests under `desktop/src/**/__tests__` and `desktop/electron/modules/agent/__tests__`.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note.

## Task 1: Shared Built-In Workspace Definition

**Files:**
- Create: `desktop/src/lib/default-agent-workspace.ts`
- Test: `desktop/src/modules/agent/__tests__/project-resolution.test.ts`
- Modify: `desktop/src/modules/agent/project-resolution.ts`

- [ ] **Step 1: Write the failing project-resolution tests**

Append these tests to `desktop/src/modules/agent/__tests__/project-resolution.test.ts`:

```ts
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
} from "@/lib/default-agent-workspace"

it("always includes the built-in local Agent workspace", () => {
  expect(resolveAgentProjectScope(null, [])).toEqual({
    defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID],
    repositoryId: undefined,
    repositoryName: undefined,
  })
})

it("prepends the built-in local Agent workspace before configured projects", () => {
  expect(resolveAgentProjectScope(null, [
    { id: "project-1", name: "Project One", path: "/repo" },
  ])).toEqual({
    defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, "project-1"],
    repositoryId: undefined,
    repositoryName: undefined,
  })
})

it("keeps the built-in workspace display name stable", () => {
  expect(DEFAULT_AGENT_WORKSPACE_PROJECT_NAME).toBe("本地对话")
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/project-resolution.test.ts --reporter=verbose
```

Expected: FAIL because `@/lib/default-agent-workspace` does not exist and `resolveAgentProjectScope` still returns no project for empty config.

- [ ] **Step 3: Add shared constants**

Create `desktop/src/lib/default-agent-workspace.ts`:

```ts
import type { SynapseProjectConfig } from "@/types/config"

export const DEFAULT_AGENT_WORKSPACE_PROJECT_ID = "builtin:default-agent-workspace"
export const DEFAULT_AGENT_WORKSPACE_PROJECT_NAME = "本地对话"

export const DEFAULT_AGENT_WORKSPACE_PROJECT: SynapseProjectConfig = {
  id: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  name: DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
  path: "synapse-agent-workspace://default",
}

export function isDefaultAgentWorkspaceProjectId(projectId: string | undefined | null): boolean {
  return projectId === DEFAULT_AGENT_WORKSPACE_PROJECT_ID
}
```

- [ ] **Step 4: Include the built-in workspace in project scope**

Update `desktop/src/modules/agent/project-resolution.ts`:

```ts
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
} from "@/lib/default-agent-workspace"
import { normalizePathForCompare } from "@/lib/path-compare"
import type { SynapseProjectConfig, SynapseRepositoryConfig } from "@/types/config"

type AgentProjectScope = {
  readonly projectIds: string[]
  readonly defaultProjectId?: string
  readonly repositoryId?: string
  readonly repositoryName?: string
}

function resolveAgentProjectScope(
  activeRepository: Pick<SynapseRepositoryConfig, "uuid" | "name" | "localPath"> | null | undefined,
  projects: readonly SynapseProjectConfig[],
  platform?: string,
): AgentProjectScope {
  const configuredProjectIds = unique(projects.map((project) => project.id).filter(Boolean))
    .filter((projectId) => projectId !== DEFAULT_AGENT_WORKSPACE_PROJECT_ID)
  const projectIds = [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, ...configuredProjectIds]
  const repositoryPath = normalizePathForCompare(activeRepository?.localPath ?? "", { platform })
  const matchedProject = repositoryPath
    ? projects.find((project) => normalizePathForCompare(project.path, { platform }) === repositoryPath)
    : undefined

  return {
    projectIds,
    defaultProjectId: matchedProject?.id ?? DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    repositoryId: activeRepository?.uuid,
    repositoryName: activeRepository?.name,
  }
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

export {
  resolveAgentProjectScope,
  type AgentProjectScope,
}
```

- [ ] **Step 5: Update the old empty-project test expectation**

Replace the test named `does not fall back to the repository id when no configured projects exist` in `desktop/src/modules/agent/__tests__/project-resolution.test.ts` with:

```ts
it("uses the built-in workspace when no configured projects exist", () => {
  expect(resolveAgentProjectScope({
    uuid: "repo-1",
    name: "Repository",
    localPath: "/repo",
  }, [])).toEqual({
    defaultProjectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    projectIds: [DEFAULT_AGENT_WORKSPACE_PROJECT_ID],
    repositoryId: "repo-1",
    repositoryName: "Repository",
  })
})
```

- [ ] **Step 6: Run the focused test and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/project-resolution.test.ts --reporter=verbose
```

Expected: PASS.

Commit:

```bash
git add desktop/src/lib/default-agent-workspace.ts desktop/src/modules/agent/project-resolution.ts desktop/src/modules/agent/__tests__/project-resolution.test.ts
git commit -m "feat(agent): define default local workspace"
```

## Task 2: App Shell No-Repository Entry

**Files:**
- Modify: `desktop/src/App.tsx`
- Test: create `desktop/src/__tests__/App.no-repository.test.tsx`

- [ ] **Step 1: Write the failing App test**

Create `desktop/src/__tests__/App.no-repository.test.tsx` by copying the mock style from `desktop/src/__tests__/App.workflow-entry.test.tsx`, with these repository and module mocks:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getStates: vi.fn(),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock("@/app-shell/components/app-shell-layout", () => ({
  AppShellLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))
vi.mock("@/app-shell/components/app-shell-navigation", () => ({
  AppShellNavigation: () => <nav>导航</nav>,
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
vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({ resetKey: "test" }),
}))
vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useHasRepositories: () => false,
  useRepositoryActions: () => ({ syncRepository: vi.fn() }),
  useRepositoryManager: () => ({ refreshRepositoryStates: vi.fn() }),
  useRepositoryState: () => undefined,
}))
vi.mock("@/app-shell/navigation", () => ({
  publishActiveAppTab: vi.fn(),
  requestOpenSettingsAccount: vi.fn(),
  requestOpenSettingsAbout: vi.fn(),
  requestOpenSettingsStorage: vi.fn(),
  subscribeOpenAgentSession: () => () => undefined,
  subscribeOpenSettingsTab: () => () => undefined,
}))
vi.mock("@/app-shell/content-navigation", () => ({ subscribeContentOpenRequest: () => () => undefined }))
vi.mock("@/app-shell/dialog-navigate", () => ({ ensureBodyInteractable: vi.fn() }))
vi.mock("@/app-shell/use-watch-next-agent-session", () => ({ useWatchNextAgentSession: vi.fn() }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => mocks.logger }))
vi.mock("@/lib/diagnostic-context", () => ({ updateDiagnosticContext: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    agent: { onOpenConversation: () => () => undefined },
    cheatCodes: { getStates: mocks.getStates, onStateChanged: () => () => undefined },
    updater: { onOpenUpdatePage: () => () => undefined },
  }),
}))
vi.mock("@/modules/rules", () => ({ RulesModule: () => <div>规则模块</div> }))
vi.mock("@/modules/skills", () => ({ SkillsModule: () => <div>技能模块</div> }))
vi.mock("@/modules/prompts", () => ({ PromptsModule: () => <div>提示词模块</div> }))
vi.mock("@/modules/settings", () => ({ SettingsModule: () => <div>设置模块</div> }))
vi.mock("@/modules/database", () => ({ DatabaseModule: () => <div>数据模块</div> }))
vi.mock("@/modules/editor-scan", () => ({ EditorScanModule: () => <div>本机模块</div> }))
vi.mock("@/modules/agent", () => ({ AgentModule: () => <div>对话模块</div> }))
vi.mock("@/modules/task-scheduler", () => ({ TaskSchedulerModule: () => <div>定时模块</div> }))
vi.mock("@/modules/automation", () => ({ AutomationModule: () => <div>自动化模块</div> }))
vi.mock("@/modules/tools", () => ({ ToolsModule: () => <div>工具模块</div> }))
vi.mock("@/modules/usage-analysis", () => ({
  CcUsageAnalysisModule: () => <div>CC 模块</div>,
  CodexUsageAnalysisModule: () => <div>Codex 模块</div>,
}))
vi.mock("@/modules/workflow", () => ({ WorkflowModule: () => <div>工作流模块</div> }))
vi.mock("@/modules/content/components/content-window-page", () => ({ ContentWindowPage: () => <div>内容窗口</div> }))
vi.mock("@/modules/usage-analysis/cc/components/conversation-detail-window-page", () => ({ CcConversationDetailWindowPage: () => <div>对话窗口</div> }))
vi.mock("@/app-shell/account-ui-visibility", () => ({ isAccountUiVisible: () => false }))

import App from "@/App"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.getStates.mockResolvedValue({})
  vi.clearAllMocks()
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.no-repository.test.tsx --reporter=verbose
```

Expected: FAIL because `EmptyRepositoryState` is rendered and `AgentModule` is not.

- [ ] **Step 3: Remove the startup repository gate and default no-repo to Agent**

In `desktop/src/App.tsx`:

```ts
const initialTab: AppTabId = hasRepositories ? DEFAULT_APP_TAB : "agent"
const [activeTab, setActiveTabRaw] = useState<AppTabId>(initialTab)
```

Remove the import:

```ts
import { EmptyRepositoryState } from "@/app-shell/components/empty-repository-state"
```

Remove these early returns:

```tsx
if (hasNoRepositories) {
  return <EmptyRepositoryState reason="no-repositories" />
}

if (isActiveRepositoryMissing) {
  return <EmptyRepositoryState reason="active-repository-missing" />
}
```

Keep `hasNoRepositories` and `isActiveRepositoryMissing` only for polling logic, or remove unused variables after updating the polling effect.

Add this effect after `setActiveTab` is declared:

```ts
useEffect(() => {
  if (!hasRepositories && activeTabRef.current === DEFAULT_APP_TAB) {
    setActiveTab("agent", "navigation")
  }
}, [hasRepositories, setActiveTab])
```

- [ ] **Step 4: Run focused App test and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.no-repository.test.tsx src/__tests__/App.workflow-entry.test.tsx --reporter=verbose
```

Expected: PASS.

Commit:

```bash
git add desktop/src/App.tsx desktop/src/__tests__/App.no-repository.test.tsx
git commit -m "feat(app): allow launch without repository"
```

## Task 3: Repository Setup Panel Extraction

**Files:**
- Create: `desktop/src/app-shell/components/repository-setup-panel.tsx`
- Modify: `desktop/src/app-shell/components/empty-repository-state.tsx`
- Test: `desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx`

- [ ] **Step 1: Write wrapper-preservation test**

Append to `desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx`:

```tsx
it("keeps repository setup actions available through the reusable panel wrapper", () => {
  renderEmptyState()

  expect(document.body.textContent).toContain("选择已有目录")
  expect(document.body.textContent).toContain("新建仓库")
})
```

- [ ] **Step 2: Run test before extraction**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/empty-repository-state.test.tsx --reporter=verbose
```

Expected: PASS before extraction. This locks the behavior that must survive the refactor.

- [ ] **Step 3: Create `RepositorySetupPanel` by moving existing logic**

Create `desktop/src/app-shell/components/repository-setup-panel.tsx` by moving the contents of `EmptyRepositoryState` except the outer full-screen wrapper and `reason`-specific title into a new component:

```tsx
type RepositorySetupPanelProps = {
  reason: "no-repositories" | "active-repository-missing"
  layout?: "full" | "embedded"
}

function RepositorySetupPanel({ reason, layout = "embedded" }: RepositorySetupPanelProps) {
  // Move the existing EmptyRepositoryState hooks, handlers, dialogs, and action buttons here.
  // Keep the current choose/create/initialize/switch behavior unchanged.
  // The root container should use:
  // layout === "full" ? "flex h-screen w-full items-center justify-center bg-background p-6" : "flex w-full items-center justify-center p-6"
}

export { RepositorySetupPanel }
export type { RepositorySetupPanelProps }
```

When moving code, preserve these existing behaviors exactly:

```ts
const dangerMessage = getRepositoryInitializationDangerMessage(validationResult.initializationPreview)
if (dangerMessage) {
  showError(dangerMessage, { durationMs: 6000 })
  return
}
```

```ts
await manager.updateConfig({ repositories: repos })
persistedRepositoryUuid = newRepository.uuid
await manager.refreshRepositoryStates()
await initializeRepository(newRepository.uuid, preview && !preview.isEmpty ? {
  confirmedOperationToken: preview.operationToken,
} : undefined)
await manager.switchActiveRepository(newRepository.uuid)
```

```ts
if (persistedRepositoryUuid) {
  const repos = manager.getRepositories()
    .filter((repo) => repo.uuid !== persistedRepositoryUuid)
  await manager.updateConfig({ repositories: repos })
  await manager.refreshRepositoryStates()
}
```

- [ ] **Step 4: Make `EmptyRepositoryState` a wrapper**

Replace `desktop/src/app-shell/components/empty-repository-state.tsx` with:

```tsx
import { RepositorySetupPanel } from "@/app-shell/components/repository-setup-panel"

type EmptyRepositoryStateProps = {
  reason: "no-repositories" | "active-repository-missing"
}

function EmptyRepositoryState({ reason }: EmptyRepositoryStateProps) {
  return <RepositorySetupPanel reason={reason} layout="full" />
}

export { EmptyRepositoryState }
export type { EmptyRepositoryStateProps }
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/empty-repository-state.test.tsx --reporter=verbose
```

Expected: PASS. The existing danger-flag, destructive preview, and rollback tests must still pass.

Commit:

```bash
git add desktop/src/app-shell/components/repository-setup-panel.tsx desktop/src/app-shell/components/empty-repository-state.tsx desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx
git commit -m "refactor(repository): extract setup panel"
```

## Task 4: Agent Sidebar Uses Built-In Local Conversation

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Add failing sidebar test**

Append to `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`:

```tsx
import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "@/lib/default-agent-workspace"

it("shows the built-in local conversation project when no configured projects exist", async () => {
  const onCreateSession = vi.fn()

  renderSidebar({
    projects: [{
      id: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      name: "本地对话",
      path: "synapse-agent-workspace://default",
    }],
    sessions: [],
    archivedSessions: [],
    onCreateSession,
  })

  expect(document.body.textContent).toContain("本地对话")
  expect(document.body.textContent).not.toContain("尚未配置项目")
})
```

If this file uses a different helper name than `renderSidebar`, adapt the call to the existing render helper and keep the same assertions.

- [ ] **Step 2: Run test to verify current sidebar behavior**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx --reporter=verbose
```

Expected: FAIL if the sidebar still renders the blocking empty state when projects are empty or if the test helper does not include the built-in project yet.

- [ ] **Step 3: Include built-in project option in AgentModule**

In `desktop/src/modules/agent/index.tsx`, import:

```ts
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT,
  isDefaultAgentWorkspaceProjectId,
} from "@/lib/default-agent-workspace"
```

Replace `projectOptions` with:

```ts
const projectOptions: ProjectOption[] = useMemo(() => [
  {
    id: DEFAULT_AGENT_WORKSPACE_PROJECT.id,
    name: DEFAULT_AGENT_WORKSPACE_PROJECT.name,
    path: DEFAULT_AGENT_WORKSPACE_PROJECT.path,
  },
  ...config.global.projects
    .filter((project) => !isDefaultAgentWorkspaceProjectId(project.id))
    .map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
], [config.global.projects])
```

Replace selected project lookup with:

```ts
const selectedProject = selectedProjectId
  ? isDefaultAgentWorkspaceProjectId(selectedProjectId)
    ? DEFAULT_AGENT_WORKSPACE_PROJECT
    : config.global.projects.find((project) => project.id === selectedProjectId)
  : undefined
```

- [ ] **Step 4: Remove normal blocking empty state from sidebar**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`, keep archived sessions rendering but remove the branch that renders:

```tsx
<EmptyTitle>尚未配置项目</EmptyTitle>
<EmptyDescription>添加项目后即可开始 Agent 对话</EmptyDescription>
```

The main render should always map `projects` and then optionally render `ArchivedGroup`.

- [ ] **Step 5: Run sidebar and Agent project tests, then commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/project-resolution.test.ts src/modules/agent/__tests__/agent-session-sidebar.test.tsx --reporter=verbose
```

Expected: PASS.

Commit:

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx
git commit -m "feat(agent): show local conversation workspace"
```

## Task 5: Electron Resolves the Built-In Project

**Files:**
- Create: `desktop/electron/modules/agent/default-agent-workspace.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`

- [ ] **Step 1: Add failing IPC session test**

At the top of `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`, add:

```ts
import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "../../../../src/lib/default-agent-workspace"
```

Add an Electron mock if the test file does not already have one:

```ts
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/user-data"),
  },
}))
```

Add this test inside `describe("agent session IPC methods", () => { ... })`:

```ts
it("creates sessions in the built-in local Agent workspace", async () => {
  vi.mocked(configStore.load).mockResolvedValue({
    repositories: [],
    global: {
      themeMode: "system",
      projects: [],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
    },
    agent: { defaultPermissionMode: "default", defaultProviderModel: null },
  } as never)
  const created = storedConversation({
    id: "local-conv",
    projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  })
  const createSession = vi.fn().mockResolvedValue(created)
  const ctx = createContext({
    agent: { createSession },
    dataRepo: {
      namespace: vi.fn(),
    } as unknown as DataRepository,
  })

  await expect(sessionMethods.createSession.handler(ctx, {
    projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    sessionKey: "local:renderer",
    agentType: "claude-code",
    providerId: "anthropic",
  })).resolves.toEqual(expect.objectContaining({
    projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    id: "local-conv",
  }))

  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
    sessionKey: "local:renderer",
    platform: "local-renderer",
    agentType: "claude-code",
    providerId: "anthropic",
  }))
})
```

- [ ] **Step 2: Run the focused IPC test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts --reporter=verbose
```

Expected: FAIL with “找不到当前项目” or missing built-in resolver.

- [ ] **Step 3: Add main-process workspace resolver**

Create `desktop/electron/modules/agent/default-agent-workspace.ts`:

```ts
import { app } from "electron"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"

import {
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
} from "../../../src/lib/default-agent-workspace"

export type DefaultAgentWorkspaceProject = {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
}

export function getDefaultAgentWorkspacePath(): string {
  return path.join(app.getPath("userData"), "agent-workspaces", "default")
}

export async function resolveDefaultAgentWorkspaceProject(): Promise<DefaultAgentWorkspaceProject> {
  const localPath = getDefaultAgentWorkspacePath()
  await mkdir(localPath, { recursive: true })
  const info = await stat(localPath)
  if (!info.isDirectory()) {
    throw new Error("本地对话工作区不可用。")
  }
  return {
    uuid: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    name: DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
    localPath,
  }
}
```

- [ ] **Step 4: Resolve built-in project in IPC shared helper**

In `desktop/electron/modules/agent/ipc-shared.ts`, import:

```ts
import { isDefaultAgentWorkspaceProjectId } from "../../../src/lib/default-agent-workspace"
import { resolveDefaultAgentWorkspaceProject } from "./default-agent-workspace"
```

Change `resolveAgentProjectConfig` into an async function:

```ts
async function resolveAgentProjectConfig(
  config: Awaited<ReturnType<typeof configStore.load>>,
  projectId: string,
): Promise<{
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly managedKnowledgeBase?: boolean
} | null> {
  if (isDefaultAgentWorkspaceProjectId(projectId)) {
    return resolveDefaultAgentWorkspaceProject()
  }
  const repository = config.repositories.find((item) => item.uuid === projectId)
  if (repository) {
    return repository
  }
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) {
    return null
  }
  return {
    uuid: project.id,
    name: project.name,
    localPath: resolveProjectWorkspacePath(project),
    ...(isManagedKnowledgeBaseProject(project) ? { managedKnowledgeBase: true } : undefined),
  }
}
```

Update `resolveProjectAgent`:

```ts
const project = await resolveAgentProjectConfig(config, projectId)
```

- [ ] **Step 5: Make the test context check opened metadata**

In `createContext` inside `ipc-sessions.test.ts`, let `open` preserve arguments:

```ts
const open = vi.fn().mockResolvedValue(container)
const projectContainers: Pick<ProjectContainerRegistry, "open"> = { open }
```

In the new test, assert:

```ts
const containers = ctx.resolve<Pick<ProjectContainerRegistry, "open">>("core.project-containers")
expect(containers.open).toHaveBeenCalledWith(DEFAULT_AGENT_WORKSPACE_PROJECT_ID, {
  name: "本地对话",
  workspacePath: "/user-data/agent-workspaces/default",
  managedKnowledgeBase: undefined,
})
```

If exact object comparison fails because optional `managedKnowledgeBase` is omitted, use:

```ts
expect(containers.open).toHaveBeenCalledWith(
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  expect.objectContaining({
    name: "本地对话",
    workspacePath: "/user-data/agent-workspaces/default",
  }),
)
```

- [ ] **Step 6: Run IPC tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts --reporter=verbose
```

Expected: PASS.

Commit:

```bash
git add desktop/electron/modules/agent/default-agent-workspace.ts desktop/electron/modules/agent/ipc-shared.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts
git commit -m "feat(agent): resolve built-in local workspace"
```

## Task 6: Content and Repository Empty States Stay Local

**Files:**
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Test: add or update `desktop/src/modules/content/components/__tests__/content-browser-page.test.tsx` if present; otherwise use source review plus App no-repository test.

- [ ] **Step 1: Locate existing content browser tests**

Run:

```bash
rg --files desktop/src/modules/content | rg "content-browser-page|__tests__"
```

Expected: Find an existing test file or confirm none exists.

- [ ] **Step 2: If a test file exists, add no-active-repository assertion**

Use the existing render helper to assert:

```tsx
expect(document.body.textContent).toContain("先选择本地目录")
expect(document.body.textContent).not.toContain("Cannot read")
```

If no test file exists, do not create a broad fixture-heavy test in this task; rely on `App.no-repository.test.tsx` and the source guard in `content-browser-page.tsx`.

- [ ] **Step 3: Keep content page guard local**

Ensure `desktop/src/modules/content/components/content-browser-page.tsx` keeps this local return:

```tsx
if (activeRepository === null) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">先选择本地目录</p>
    </div>
  )
}
```

Do not call repository setup from `App.tsx`. If adding a setup entry inside content later, use `RepositorySetupPanel layout="embedded"` rather than `EmptyRepositoryState`.

- [ ] **Step 4: Commit if changes were needed**

If this task only verifies existing behavior, do not create an empty commit. If tests or content code changed:

```bash
git add desktop/src/modules/content/components/content-browser-page.tsx desktop/src/modules/content/components/__tests__
git commit -m "test(content): cover no repository empty state"
```

## Task 7: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing entry to `RELEASE_NOTES_PENDING.md`:

```md
- Synapse 现在不再要求先选择本地仓库才能进入应用。没有仓库时会直接打开“对话”，并提供内置的“本地对话”空间；仓库相关的内容管理功能仍可在需要时单独添加本地目录。
```

- [ ] **Step 2: Run focused renderer and Electron tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/__tests__/App.no-repository.test.tsx \
  src/__tests__/App.workflow-entry.test.tsx \
  src/modules/agent/__tests__/project-resolution.test.ts \
  src/modules/agent/__tests__/agent-session-sidebar.test.tsx \
  src/app-shell/components/__tests__/empty-repository-state.test.tsx \
  electron/modules/agent/__tests__/ipc-sessions.test.ts \
  --reporter=verbose
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If typecheck reports unrelated pre-existing failures, record exact files and still keep the focused tests passing.

- [ ] **Step 4: Commit release note**

Commit:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note optional repository launch"
```

## Self-Review

Spec coverage:

- App no longer blocks on missing repositories: Task 2.
- Built-in local Agent project and app-managed workspace: Tasks 1 and 5.
- Agent sidebar has “本地对话” and create entry: Task 4.
- Existing repository setup flows are reused as components: Task 3.
- Content and repository functions stay local empty states: Task 6.
- Existing project and Knowledge Base behavior preserved: Tasks 4 and 5 avoid writing built-in project to config and avoid Knowledge Base flags.
- Tests and release note included: Task 7.

Placeholder scan:

- No task uses open-ended placeholder implementation instructions. The only conditional section is Task 6, where the plan explicitly says how to proceed depending on existing test availability.

Type consistency:

- Built-in ID is `DEFAULT_AGENT_WORKSPACE_PROJECT_ID`.
- UI label is `DEFAULT_AGENT_WORKSPACE_PROJECT_NAME`.
- Renderer virtual path is `synapse-agent-workspace://default`.
- Main-process workspace directory is `<userData>/agent-workspaces/default/`.
