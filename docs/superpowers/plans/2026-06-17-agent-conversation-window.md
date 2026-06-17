# Agent Conversation Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full, fixed-current-conversation Agent window and refactor the red-box conversation area into a reusable workspace component.

**Architecture:** Introduce shared agent conversation window request types and URL parsing, then add target-aware chat actions so workspace operations do not depend on implicit selected state. Electron owns single-instance detached windows and broadcasts the detached list; renderer uses that list to either render the shared workspace or a compact “already opened” placeholder.

**Tech Stack:** Electron BrowserWindow, React, TypeScript, shadcn/Radix UI, Tailwind token classes, lucide-react, Vitest.

---

## File Structure

- Create `desktop/src/types/agent-conversation-window.ts`: shared target, detached window, IPC result, and window request types.
- Create `desktop/src/lib/agent-conversation-window.ts`: URL builder/parser helpers for `synapseWindow=agent-conversation`.
- Create `desktop/src/lib/__tests__/agent-conversation-window.test.ts`: parser/builder tests.
- Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`: allow permission mode and cancel actions to take an explicit target.
- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`: expose the widened method signatures.
- Modify `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`: target-aware regression tests.
- Create `desktop/electron/services/agent-conversation-window-service.ts`: single-instance BrowserWindow manager and detached list broadcaster.
- Create `desktop/electron/services/__tests__/agent-conversation-window-service.test.ts`: service tests.
- Modify `desktop/electron/bootstrap/descriptors.ts`: register the detached conversation window service descriptor.
- Modify `desktop/electron/bootstrap/registry.ts`: add the descriptor to the service registry.
- Modify `desktop/electron/modules/agent/ipc.ts`: add detached-window event schema.
- Modify `desktop/electron/modules/agent/ipc-sessions.ts`: add open/focus/list detached window methods.
- Modify `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`: IPC validation and handler tests.
- Modify `desktop/electron/preload.ts`: expose new bridge methods and event subscription.
- Modify `desktop/src/types/bridge.ts`: type new bridge methods.
- Create `desktop/src/modules/agent/hooks/use-detached-agent-conversations.ts`: renderer hook for detached list state.
- Create `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`: reusable red-box workspace.
- Create `desktop/src/modules/agent/components/agent-detached-placeholder.tsx`: main-window placeholder for detached sessions.
- Modify `desktop/src/modules/agent/index.tsx`: replace inline red-box UI with workspace/placeholder.
- Create `desktop/src/modules/agent/__tests__/agent-conversation-workspace.test.tsx`: workspace tests.
- Modify `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`: main module detached placeholder coverage.
- Create `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`: standalone fixed-conversation window page.
- Modify `desktop/src/App.tsx`: route `synapseWindow=agent-conversation`.
- Modify `RELEASE_NOTES_PENDING.md`: user-facing release note.

## Task 1: Window Request Types And URL Parser

**Files:**
- Create: `desktop/src/types/agent-conversation-window.ts`
- Create: `desktop/src/lib/agent-conversation-window.ts`
- Create: `desktop/src/lib/__tests__/agent-conversation-window.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `desktop/src/lib/__tests__/agent-conversation-window.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildAgentConversationWindowSearchParams,
  parseAgentConversationWindowRequest,
} from "@/lib/agent-conversation-window"

describe("agent conversation window request parsing", () => {
  it("round-trips an agent conversation window request", () => {
    const params = buildAgentConversationWindowSearchParams({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话 08:04 AM",
    })

    expect(parseAgentConversationWindowRequest(`?${params.toString()}`)).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话 08:04 AM",
    })
  })

  it("omits blank optional title", () => {
    const params = buildAgentConversationWindowSearchParams({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "   ",
    })

    expect(parseAgentConversationWindowRequest(`?${params.toString()}`)).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })
  })

  it("rejects non-agent-conversation windows", () => {
    expect(parseAgentConversationWindowRequest("?synapseWindow=content&id=x")).toBeNull()
  })

  it("rejects missing target fields", () => {
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&projectId=p&conversationId=c")).toBeNull()
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&projectId=p&sessionKey=s")).toBeNull()
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&conversationId=c&sessionKey=s")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the parser test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-window.test.ts
```

Expected: FAIL because `@/lib/agent-conversation-window` does not exist.

- [ ] **Step 3: Add shared types**

Create `desktop/src/types/agent-conversation-window.ts`:

```ts
export type AgentConversationTarget = {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey: string
}

export type AgentConversationWindowRequest = AgentConversationTarget & {
  readonly title?: string
}

export type AgentDetachedConversation = AgentConversationTarget & {
  readonly title: string
  readonly windowId: number
  readonly openedAt: string
}

export type AgentConversationWindowOpenResult = {
  readonly opened: true
}

export type AgentConversationWindowFocusResult = {
  readonly focused: boolean
}
```

- [ ] **Step 4: Implement the URL helpers**

Create `desktop/src/lib/agent-conversation-window.ts`:

```ts
import type { AgentConversationWindowRequest } from "@/types/agent-conversation-window"

const WINDOW_KIND_PARAM = "synapseWindow"
const WINDOW_KIND = "agent-conversation"

function normalizeRequiredParam(value: string | null): string | null {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalParam(value: string | null): string | undefined {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : undefined
}

export function buildAgentConversationWindowSearchParams(
  request: AgentConversationWindowRequest,
): URLSearchParams {
  const params = new URLSearchParams({
    [WINDOW_KIND_PARAM]: WINDOW_KIND,
    projectId: request.projectId,
    conversationId: request.conversationId,
    sessionKey: request.sessionKey,
  })

  const title = normalizeOptionalParam(request.title ?? null)
  if (title) params.set("title", title)

  return params
}

export function parseAgentConversationWindowRequest(search: string): AgentConversationWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get(WINDOW_KIND_PARAM) !== WINDOW_KIND) return null

  const projectId = normalizeRequiredParam(params.get("projectId"))
  const conversationId = normalizeRequiredParam(params.get("conversationId"))
  const sessionKey = normalizeRequiredParam(params.get("sessionKey"))
  if (!projectId || !conversationId || !sessionKey) return null

  const title = normalizeOptionalParam(params.get("title"))
  return {
    projectId,
    conversationId,
    sessionKey,
    ...(title ? { title } : {}),
  }
}
```

- [ ] **Step 5: Run the parser test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-window.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/agent-conversation-window.ts desktop/src/lib/agent-conversation-window.ts desktop/src/lib/__tests__/agent-conversation-window.test.ts
git commit -m "feat(agent): add conversation window request helpers"
```

## Task 2: Target-Aware Chat Actions

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Test: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Add failing tests for explicit targets**

In `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`, add tests near the existing permission/cancel tests. These tests reuse the file's existing `HookProbe`, `session`, `nextSession`, `projectScope`, `roots`, and `waitFor` helpers:

```ts
it("sets permission mode for an explicit target", async () => {
  const bridge = (window as unknown as {
    synapse: {
      agent: {
        listSessions: ReturnType<typeof vi.fn>
        setPermissionMode: ReturnType<typeof vi.fn>
      }
    }
  }).synapse.agent
  bridge.listSessions.mockResolvedValue([session, { ...nextSession, projectId: "project-2" }])
  let chat: ReturnType<typeof useAgentChat> | undefined
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <HookProbe onChange={(next) => {
        chat = next
      }}
      />,
    )
  })
  await waitFor(() => chat?.selectedConversationId === session.id)

  await act(async () => {
    await chat?.setPermissionMode("acceptEdits", {
      projectId: "project-2",
      conversationId: "conversation-2",
      sessionKey: "local:renderer",
    })
  })

  expect(bridge.setPermissionMode).toHaveBeenCalledWith({
    projectId: "project-2",
    conversationId: "conversation-2",
    mode: "acceptEdits",
  })
})

it("cancels and force kills an explicit target", async () => {
  const bridge = (window as unknown as {
    synapse: {
      agent: {
        listSessions: ReturnType<typeof vi.fn>
        cancelTurn: ReturnType<typeof vi.fn>
        forceKillTurn: ReturnType<typeof vi.fn>
      }
    }
  }).synapse.agent
  bridge.listSessions.mockResolvedValue([session, { ...nextSession, projectId: "project-2" }])
  let chat: ReturnType<typeof useAgentChat> | undefined
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <HookProbe onChange={(next) => {
        chat = next
      }}
      />,
    )
  })
  await waitFor(() => chat?.selectedConversationId === session.id)

  await act(async () => {
    await chat?.cancelTurn({
      projectId: "project-2",
      conversationId: "conversation-2",
      sessionKey: "local:renderer",
    })
    await chat?.forceKillTurn({
      projectId: "project-2",
      conversationId: "conversation-2",
      sessionKey: "local:renderer",
    })
  })

  expect(bridge.cancelTurn).toHaveBeenCalledWith({
    projectId: "project-2",
    conversationId: "conversation-2",
  })
  expect(bridge.forceKillTurn).toHaveBeenCalledWith({
    projectId: "project-2",
    conversationId: "conversation-2",
  })
})
```

- [ ] **Step 2: Run the focused hook tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: FAIL because `setPermissionMode`, `cancelTurn`, and `forceKillTurn` do not accept a target argument yet.

- [ ] **Step 3: Widen hook result signatures**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, import the shared target type:

```ts
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
```

Then change `UseAgentChatState` method signatures:

```ts
  setPermissionMode: (mode: SynapseAgentPermissionMode, target?: AgentConversationTarget) => Promise<void>
  cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
```

- [ ] **Step 4: Widen connection signatures and implementation**

In `desktop/src/modules/agent/hooks/use-chat-connection.ts`, import the target type:

```ts
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
```

Update `ChatConnectionResult`:

```ts
  readonly setPermissionMode: (mode: SynapseAgentPermissionMode, target?: AgentConversationTarget) => Promise<void>
  readonly cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
```

Add a helper near `isSelectedTimelineTarget`:

```ts
function resolveActionTarget(
  explicitTarget: AgentConversationTarget | undefined,
  selected: {
    readonly projectId?: string
    readonly conversationId?: string
  },
  getDefaultProjectId: () => string | undefined,
): { readonly projectId?: string; readonly conversationId?: string } {
  if (explicitTarget) {
    return {
      projectId: explicitTarget.projectId,
      conversationId: explicitTarget.conversationId,
    }
  }
  return {
    projectId: selected.projectId ?? getDefaultProjectId(),
    conversationId: selected.conversationId,
  }
}
```

Replace the start of `setPermissionMode` with:

```ts
  const setPermissionMode = useCallback(async (
    mode: SynapseAgentPermissionMode,
    target?: AgentConversationTarget,
  ) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
```

Replace the start of `cancelTurn` with:

```ts
  const cancelTurn = useCallback(async (target?: AgentConversationTarget) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
```

Replace the start of `forceKillTurn` with:

```ts
  const forceKillTurn = useCallback(async (target?: AgentConversationTarget) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
```

Leave the existing call sites valid by keeping the target optional.

- [ ] **Step 5: Run the hook tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-chat-connection.ts desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
git commit -m "feat(agent): target conversation controls"
```

## Task 3: Electron Detached Conversation Window Service

**Files:**
- Create: `desktop/electron/services/agent-conversation-window-service.ts`
- Create: `desktop/electron/services/__tests__/agent-conversation-window-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/agent-conversation-window-service.test.ts` with an in-memory fake BrowserWindow matching existing service test style:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL,
  createAgentConversationWindowService,
} from "../agent-conversation-window-service"

function createFakeWindow() {
  const listeners = new Map<string, Array<() => void>>()
  const window = {
    id: Math.floor(Math.random() * 100000),
    webContents: {
      id: Math.floor(Math.random() * 100000),
      on: vi.fn(),
      send: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    show: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "ready-to-show") listener()
    }),
    on: vi.fn((event: string, listener: () => void) => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.concat(listener))
    }),
    emitClosed: () => {
      for (const listener of listeners.get("closed") ?? []) listener()
    },
  }
  return window
}

describe("agent conversation window service", () => {
  it("opens one window per conversation and focuses duplicates", async () => {
    const broadcasts: unknown[] = []
    const firstWindow = createFakeWindow()
    const createWindow = vi.fn(() => firstWindow as never)
    const service = createAgentConversationWindowService({
      createWindow,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: (_channel, payload) => {
        broadcasts.push(payload)
        return 1
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })
    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(firstWindow.focus).toHaveBeenCalled()
    expect(service.listDetachedConversations()).toEqual([{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: firstWindow.id,
      openedAt: "2026-06-17T00:00:00.000Z",
    }])
    expect(broadcasts.length).toBeGreaterThan(0)
  })

  it("removes detached state when the window closes", async () => {
    const firstWindow = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => firstWindow as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })
    firstWindow.emitClosed()

    expect(service.listDetachedConversations()).toEqual([])
  })

  it("focuses an existing detached window", async () => {
    const firstWindow = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => firstWindow as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })

    expect(service.focusConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })).toEqual({ focused: true })
    expect(firstWindow.focus).toHaveBeenCalled()
    expect(AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL).toBe("synapse:agent:detached-conversations-changed")
  })
})
```

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/agent-conversation-window-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Create `desktop/electron/services/agent-conversation-window-service.ts`:

```ts
import { app, BrowserWindow } from "electron"
import path from "node:path"

import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import { buildAgentConversationWindowSearchParams } from "../../src/lib/agent-conversation-window"
import type {
  AgentConversationTarget,
  AgentConversationWindowFocusResult,
  AgentConversationWindowOpenResult,
  AgentConversationWindowRequest,
  AgentDetachedConversation,
} from "../../src/types/agent-conversation-window"
import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import type { WindowManager } from "../runtime/window"
import { getWindowIconPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"

export const AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL = "synapse:agent:detached-conversations-changed"
export const AGENT_CONVERSATION_WINDOW_SERVICE_ID = "agent.conversation-window-service"

type Logger = {
  readonly info: (message: string, metadata?: Record<string, unknown>) => void
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void
  readonly error: (message: string, metadata?: Record<string, unknown>) => void
}

type Deps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getPreloadPath: () => string
  readonly getIconPath: () => string | null
  readonly now: () => string
  readonly broadcast: (channel: string, payload: unknown) => number
  readonly logger: Logger
}

const WINDOW_BOUNDS = {
  width: 1120,
  height: 760,
  minWidth: 900,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}

function keyForTarget(target: Pick<AgentConversationTarget, "projectId" | "conversationId">): string {
  return `${target.projectId}:${target.conversationId}`
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.focus()
}

function buildUrl(baseUrl: string, request: AgentConversationWindowRequest): string {
  const params = buildAgentConversationWindowSearchParams(request)
  const separator = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}${separator}${params.toString()}`
}

export function createAgentConversationWindowService(deps: Deps) {
  const windowsByKey = new Map<string, BrowserWindow>()
  const detachedByKey = new Map<string, AgentDetachedConversation>()

  const broadcastDetached = () => {
    deps.broadcast(AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL, listDetachedConversations())
  }

  const listDetachedConversations = (): AgentDetachedConversation[] =>
    [...detachedByKey.values()].sort((left, right) => left.openedAt.localeCompare(right.openedAt))

  return {
    async openConversationWindow(request: AgentConversationWindowRequest): Promise<AgentConversationWindowOpenResult> {
      const key = keyForTarget(request)
      const existing = windowsByKey.get(key)
      if (existing && !existing.isDestroyed()) {
        focusWindow(existing)
        deps.logger.info("Focused existing agent conversation window.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
        })
        return { opened: true }
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...WINDOW_BOUNDS,
        show: false,
        title: request.title || "对话",
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      windowsByKey.set(key, window)
      detachedByKey.set(key, {
        projectId: request.projectId,
        conversationId: request.conversationId,
        sessionKey: request.sessionKey,
        title: request.title?.trim() || "对话",
        windowId: window.id,
        openedAt: deps.now(),
      })
      broadcastDetached()

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Agent conversation window preload script failed.", { error })
      })
      window.once("ready-to-show", () => {
        window.show()
      })
      window.on("closed", () => {
        windowsByKey.delete(key)
        detachedByKey.delete(key)
        broadcastDetached()
      })

      try {
        await window.loadURL(buildUrl(deps.baseUrl(), request))
      } catch (error) {
        windowsByKey.delete(key)
        detachedByKey.delete(key)
        broadcastDetached()
        deps.logger.error("Failed to load agent conversation window.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          error,
        })
        if (!window.isDestroyed()) window.close()
        throw error
      }
      return { opened: true }
    },

    focusConversationWindow(target: AgentConversationTarget): AgentConversationWindowFocusResult {
      const window = windowsByKey.get(keyForTarget(target))
      if (!window || window.isDestroyed()) return { focused: false }
      focusWindow(window)
      return { focused: true }
    },

    listDetachedConversations,
  }
}

export type AgentConversationWindowService = ReturnType<typeof createAgentConversationWindowService>

export function createDefaultAgentConversationWindowService(windowManager: WindowManager): AgentConversationWindowService {
  return createAgentConversationWindowService({
    createWindow: (options) => new BrowserWindow(options),
    baseUrl: rendererBaseUrl,
    getPreloadPath: () => path.join(__dirname, "../preload.js"),
    getIconPath: () => getWindowIconPath() ?? null,
    now: () => new Date().toISOString(),
    broadcast: (channel, payload) => windowManager.broadcast(channel, payload),
    logger: createMainLogger("agent-conversation-window"),
  })
}
```

- [ ] **Step 4: Run the service test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/agent-conversation-window-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-conversation-window-service.ts desktop/electron/services/__tests__/agent-conversation-window-service.test.ts
git commit -m "feat(agent): manage detached conversation windows"
```

## Task 4: IPC, Preload, And Bridge Wiring

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/modules/agent/ipc.ts`
- Modify: `desktop/electron/modules/agent/ipc-sessions.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add failing IPC tests**

In `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`, extend the existing `createContext` helper signature:

```ts
function createContext(overrides: {
  readonly agent: Record<string, unknown>
  readonly dataRepo: DataRepository
  readonly storageMigration?: { isActive: ReturnType<typeof vi.fn> }
  readonly windowManager?: WindowManager
  readonly conversationWindowService?: {
    readonly openConversationWindow: ReturnType<typeof vi.fn>
    readonly focusConversationWindow: ReturnType<typeof vi.fn>
    readonly listDetachedConversations: ReturnType<typeof vi.fn>
  }
}): IpcHandlerContext & {
  readonly projectContainers: Pick<ProjectContainerRegistry, "open">
} {
  // Keep the existing helper body. Add this branch in resolve(), before the final throw.
  if (serviceId === "agent.conversation-window-service" && overrides.conversationWindowService) {
    return overrides.conversationWindowService as T
  }
}
```

Then add tests for the new handlers:

```ts
it("opens an agent conversation window", async () => {
  const service = {
    openConversationWindow: vi.fn(async () => ({ opened: true })),
    focusConversationWindow: vi.fn(),
    listDetachedConversations: vi.fn(),
  }
  const ctx = createContext({
    agent: {},
    dataRepo: {
      namespace: vi.fn(() => createConversationNamespace([])),
    } as unknown as DataRepository,
    conversationWindowService: service,
  })

  await expect(sessionMethods.openConversationWindow.handler(ctx, {
    projectId: "project-1",
    conversationId: "conversation-1",
    sessionKey: "local:renderer",
    title: "新会话",
  })).resolves.toEqual({ opened: true })

  expect(service.openConversationWindow).toHaveBeenCalledWith({
    projectId: "project-1",
    conversationId: "conversation-1",
    sessionKey: "local:renderer",
    title: "新会话",
  })
})

it("focuses an agent conversation window", async () => {
  const service = {
    openConversationWindow: vi.fn(),
    focusConversationWindow: vi.fn(() => ({ focused: true })),
    listDetachedConversations: vi.fn(),
  }
  const ctx = createContext({
    agent: {},
    dataRepo: {
      namespace: vi.fn(() => createConversationNamespace([])),
    } as unknown as DataRepository,
    conversationWindowService: service,
  })

  await expect(sessionMethods.focusConversationWindow.handler(ctx, {
    projectId: "project-1",
    conversationId: "conversation-1",
    sessionKey: "local:renderer",
  })).resolves.toEqual({ focused: true })
})

it("lists detached agent conversation windows", async () => {
  const service = {
    openConversationWindow: vi.fn(),
    focusConversationWindow: vi.fn(),
    listDetachedConversations: vi.fn(() => [{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: 10,
      openedAt: "2026-06-17T00:00:00.000Z",
    }]),
  }
  const ctx = createContext({
    agent: {},
    dataRepo: {
      namespace: vi.fn(() => createConversationNamespace([])),
    } as unknown as DataRepository,
    conversationWindowService: service,
  })

  await expect(sessionMethods.listDetachedConversationWindows.handler(ctx, {})).resolves.toHaveLength(1)
})
```

- [ ] **Step 2: Run IPC tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts
```

Expected: FAIL because the new session methods are not registered.

- [ ] **Step 3: Register the window service descriptor**

In `desktop/electron/bootstrap/descriptors.ts`, add imports near other service imports:

```ts
import {
  AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  createDefaultAgentConversationWindowService,
  type AgentConversationWindowService,
} from "../services/agent-conversation-window-service"
```

Add this descriptor near the other window-related descriptors:

```ts
export const coreAgentConversationWindowDescriptor: ServiceDescriptor<AgentConversationWindowService> = {
  id: AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  criticality: "degraded",
  dependsOn: ["core.window-manager"],
  create(ctx) {
    return createDefaultAgentConversationWindowService(
      ctx.registry.get<WindowManager>("core.window-manager"),
    )
  },
}
```

In `desktop/electron/bootstrap/registry.ts`, import `coreAgentConversationWindowDescriptor` from `./descriptors` and register it after `coreWindowManagerDescriptor`:

```ts
registry.register(coreWindowManagerDescriptor)
registry.register(coreAgentConversationWindowDescriptor)
```

- [ ] **Step 4: Add IPC schemas and handlers**

In `desktop/electron/modules/agent/ipc-sessions.ts`, add imports:

```ts
import {
  AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  type AgentConversationWindowService,
} from "../../services/agent-conversation-window-service"
```

Add schemas:

```ts
const agentConversationTargetSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionKey: z.string().min(1),
})

const openConversationWindowRequestSchema = agentConversationTargetSchema.extend({
  title: z.string().optional(),
})

const detachedConversationSchema = agentConversationTargetSchema.extend({
  title: z.string(),
  windowId: z.number(),
  openedAt: z.string(),
})
```

Add methods inside `sessionMethods`:

```ts
  openConversationWindow: {
    kind: "invoke",
    channel: "synapse:agent:open-conversation-window",
    request: openConversationWindowRequestSchema,
    response: z.object({ opened: z.literal(true) }),
    handler: async (ctx, request) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.openConversationWindow(request)
    },
  },
  focusConversationWindow: {
    kind: "invoke",
    channel: "synapse:agent:focus-conversation-window",
    request: agentConversationTargetSchema,
    response: z.object({ focused: z.boolean() }),
    handler: async (ctx, request) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.focusConversationWindow(request)
    },
  },
  listDetachedConversationWindows: {
    kind: "invoke",
    channel: "synapse:agent:list-detached-conversation-windows",
    request: z.object({}),
    response: z.array(detachedConversationSchema),
    handler: async (ctx) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.listDetachedConversations()
    },
  },
```

- [ ] **Step 5: Add event schema**

In `desktop/electron/modules/agent/ipc.ts`, import the channel constant:

```ts
import { AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL } from "../../services/agent-conversation-window-service"
```

Add detached event schema near other agent event schemas:

```ts
const agentDetachedConversationSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  sessionKey: z.string(),
  title: z.string(),
  windowId: z.number(),
  openedAt: z.string(),
})
```

Add an event descriptor:

```ts
    detachedConversationsChanged: {
      kind: "event",
      channel: AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL,
      payload: z.array(agentDetachedConversationSchema),
    },
```

- [ ] **Step 6: Expose preload bridge methods**

In `desktop/electron/preload.ts`, add channels under `IPC_CHANNELS.agent`:

```ts
    "openConversationWindow": "synapse:agent:open-conversation-window",
    "focusConversationWindow": "synapse:agent:focus-conversation-window",
    "listDetachedConversationWindows": "synapse:agent:list-detached-conversation-windows",
    "detachedConversationsChanged": "synapse:agent:detached-conversations-changed",
```

Expose methods in the `agent` bridge object:

```ts
    openConversationWindow: (request) => ipcRenderer.invoke(IPC_CHANNELS.agent.openConversationWindow, request),
    focusConversationWindow: (target) => ipcRenderer.invoke(IPC_CHANNELS.agent.focusConversationWindow, target),
    listDetachedConversationWindows: () => ipcRenderer.invoke(IPC_CHANNELS.agent.listDetachedConversationWindows, {}),
    onDetachedConversationWindowsChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        listener(payload as AgentDetachedConversation[])
      }
      ipcRenderer.on(IPC_CHANNELS.agent.detachedConversationsChanged, handler)
      return () => ipcRenderer.off(IPC_CHANNELS.agent.detachedConversationsChanged, handler)
    },
```

Import `AgentDetachedConversation` in preload type imports if needed.

- [ ] **Step 7: Add bridge types**

In `desktop/src/types/bridge.ts`, import:

```ts
import type {
  AgentConversationTarget,
  AgentConversationWindowFocusResult,
  AgentConversationWindowOpenResult,
  AgentConversationWindowRequest,
  AgentDetachedConversation,
} from "./agent-conversation-window"
```

Add to `SynapseBridge["agent"]`:

```ts
    openConversationWindow: (
      request: AgentConversationWindowRequest,
    ) => Promise<AgentConversationWindowOpenResult>
    focusConversationWindow: (
      target: AgentConversationTarget,
    ) => Promise<AgentConversationWindowFocusResult>
    listDetachedConversationWindows: () => Promise<AgentDetachedConversation[]>
    onDetachedConversationWindowsChanged: (
      listener: (items: AgentDetachedConversation[]) => void,
    ) => () => void
```

- [ ] **Step 8: Run IPC, registry, and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts electron/bootstrap/__tests__/registry.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/modules/agent/ipc.ts desktop/electron/modules/agent/ipc-sessions.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(agent): expose detached conversation windows"
```

## Task 5: Detached Conversation Hook And Placeholder

**Files:**
- Create: `desktop/src/modules/agent/hooks/use-detached-agent-conversations.ts`
- Create: `desktop/src/modules/agent/components/agent-detached-placeholder.tsx`
- Test: `desktop/src/modules/agent/__tests__/detached-agent-conversations.test.tsx`

- [ ] **Step 1: Write failing hook and placeholder tests**

Create `desktop/src/modules/agent/__tests__/detached-agent-conversations.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AgentDetachedConversation } from "@/types/agent-conversation-window"
import { AgentDetachedPlaceholder } from "../components/agent-detached-placeholder"
import { useDetachedAgentConversations } from "../hooks/use-detached-agent-conversations"

function HookProbe({ onValue }: { readonly onValue: (items: readonly AgentDetachedConversation[]) => void }) {
  const items = useDetachedAgentConversations()
  onValue(items)
  return null
}

describe("detached agent conversations", () => {
  it("loads and updates detached conversations", async () => {
    const listeners: Array<(items: AgentDetachedConversation[]) => void> = []
    const first = [{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: 1,
      openedAt: "2026-06-17T00:00:00.000Z",
    }]
    vi.stubGlobal("synapse", {
      agent: {
        listDetachedConversationWindows: vi.fn(async () => first),
        onDetachedConversationWindowsChanged: vi.fn((listener) => {
          listeners.push(listener)
          return () => undefined
        }),
      },
    })
    const values: readonly AgentDetachedConversation[][] = []

    render(<HookProbe onValue={(items) => values.push(items)} />)
    await act(async () => await Promise.resolve())
    expect(values.at(-1)).toEqual(first)

    const next: AgentDetachedConversation[] = []
    act(() => listeners[0]?.(next))
    expect(values.at(-1)).toEqual(next)
  })

  it("renders a focused placeholder", () => {
    const onShowWindow = vi.fn()
    render(<AgentDetachedPlaceholder onShowWindow={onShowWindow} />)

    screen.getByText("已经在新窗口打开")
    screen.getByRole("button", { name: "显示窗口" }).click()

    expect(onShowWindow).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/detached-agent-conversations.test.tsx
```

Expected: FAIL because the hook and component do not exist.

- [ ] **Step 3: Implement the hook**

Create `desktop/src/modules/agent/hooks/use-detached-agent-conversations.ts`:

```ts
import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { AgentDetachedConversation } from "@/types/agent-conversation-window"

const logger = createRendererLogger("agent")

export function useDetachedAgentConversations(): readonly AgentDetachedConversation[] {
  const [items, setItems] = useState<AgentDetachedConversation[]>([])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge?.agent.listDetachedConversationWindows || !bridge.agent.onDetachedConversationWindowsChanged) {
      setItems([])
      return undefined
    }
    let cancelled = false
    void bridge.agent.listDetachedConversationWindows()
      .then((next) => {
        if (!cancelled) setItems([...next])
      })
      .catch((error) => {
        logger.warn("Detached agent conversation list failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
        if (!cancelled) setItems([])
      })

    const unsubscribe = bridge.agent.onDetachedConversationWindowsChanged((next) => {
      setItems([...next])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return items
}

export function isDetachedAgentConversation(
  items: readonly AgentDetachedConversation[],
  target: { readonly projectId?: string; readonly conversationId?: string },
): boolean {
  if (!target.projectId || !target.conversationId) return false
  return items.some((item) =>
    item.projectId === target.projectId && item.conversationId === target.conversationId)
}
```

- [ ] **Step 4: Implement the placeholder**

Create `desktop/src/modules/agent/components/agent-detached-placeholder.tsx`:

```tsx
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

function AgentDetachedPlaceholder({ onShowWindow }: { readonly onShowWindow: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm font-medium">已经在新窗口打开</p>
        <Button type="button" variant="outline" size="sm" onClick={onShowWindow}>
          <ExternalLink data-icon="inline-start" />
          显示窗口
        </Button>
      </div>
    </div>
  )
}

export { AgentDetachedPlaceholder }
```

- [ ] **Step 5: Run the test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/detached-agent-conversations.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-detached-agent-conversations.ts desktop/src/modules/agent/components/agent-detached-placeholder.tsx desktop/src/modules/agent/__tests__/detached-agent-conversations.test.tsx
git commit -m "feat(agent): track detached conversations in renderer"
```

## Task 6: Extract AgentConversationWorkspace

**Files:**
- Create: `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Create: `desktop/src/modules/agent/__tests__/agent-conversation-workspace.test.tsx`
- Modify: `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`

- [ ] **Step 1: Write failing workspace tests**

Create `desktop/src/modules/agent/__tests__/agent-conversation-workspace.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentConversationWorkspace } from "../components/agent-conversation-workspace"
import type { AgentConversationWorkspaceController } from "../components/agent-conversation-workspace"

function controller(overrides: Partial<AgentConversationWorkspaceController> = {}): AgentConversationWorkspaceController {
  return {
    timeline: [],
    pendingPermissions: [],
    sending: false,
    sendingConversationIds: new Set(),
    cancelPhase: "idle",
    error: null,
    sendMessage: vi.fn(async () => true),
    createSession: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
    forceKillTurn: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  }
}

const session = {
  id: "conversation-1",
  projectId: "project-1",
  sessionKey: "local:renderer",
  name: "新会话",
  active: true,
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
  historyCount: 0,
  mode: "default",
  providerId: "provider-1",
  modelTier: "sonnet",
  agentType: "claude-code",
} as const

describe("AgentConversationWorkspace", () => {
  it("renders embedded conversation controls and opens detached window", () => {
    const onOpenDetached = vi.fn()
    render(
      <AgentConversationWorkspace
        session={session}
        target={{ projectId: "project-1", conversationId: "conversation-1", sessionKey: "local:renderer" }}
        chat={controller()}
        quickInputs={[]}
        commands={[]}
        providers={{ activeProviderId: "provider-1", providers: [{ id: "provider-1", name: "百炼", active: true, models: [] }] } as never}
        currentConversationModel="glm-5.1"
        displayProfile={{
          agentLabel: "Agent",
          thinkingDefaultCollapsed: false,
          toolDefaultCollapsed: "auto",
          toolPreviewLines: 6,
          toolPreviewChars: 1200,
          statusLabels: { pending: "Pending", running: "Running", success: "Done", error: "Failed", denied: "Denied" },
        }}
        mode="embedded"
        onOpenDetached={onOpenDetached}
      />,
    )

    screen.getByText("新会话")
    fireEvent.click(screen.getByRole("button", { name: "新窗口打开" }))
    expect(onOpenDetached).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })
  })

  it("hides detached button in window mode", () => {
    render(
      <AgentConversationWorkspace
        session={session}
        target={{ projectId: "project-1", conversationId: "conversation-1", sessionKey: "local:renderer" }}
        chat={controller()}
        quickInputs={[]}
        commands={[]}
        providers={null}
        displayProfile={{
          agentLabel: "Agent",
          thinkingDefaultCollapsed: false,
          toolDefaultCollapsed: "auto",
          toolPreviewLines: 6,
          toolPreviewChars: 1200,
          statusLabels: { pending: "Pending", running: "Running", success: "Done", error: "Failed", denied: "Denied" },
        }}
        mode="window"
      />,
    )

    expect(screen.queryByRole("button", { name: "新窗口打开" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the workspace test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-conversation-workspace.test.tsx
```

Expected: FAIL because `AgentConversationWorkspace` does not exist.

- [ ] **Step 3: Move red-box logic into the workspace**

Create `desktop/src/modules/agent/components/agent-conversation-workspace.tsx` by moving from `desktop/src/modules/agent/index.tsx`:

- local state: `draft`, `pendingMessages`, `isExportingConversation`, pending queue id ref, idle rollover timer.
- handlers: submit, keydown, pending queue, copy transcript, export conversation, pending permission/question focus, open source manager, open reference, knowledge base command send.
- derived values: `target`, provider/model label, selected display profile, selected permission mode, slash candidates, knowledge base actions, selected pending messages, jump-to-bottom state.

Keep the exported types:

```ts
export type AgentConversationTarget = ImportedAgentConversationTarget
export type AgentConversationWorkspaceController = {
  readonly timeline: readonly SynapseAgentTimelineItem[]
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly sending: boolean
  readonly sendingConversationIds: ReadonlySet<string>
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly error: string | null
  readonly sendMessage: (content: string, target: AgentConversationTarget, options?: SendMessageOptions) => Promise<boolean>
  readonly createSession: (projectId: string, providerId?: string, mode?: SynapseAgentPermissionMode, modelTier?: string) => Promise<void>
  readonly setPermissionMode: (mode: SynapseAgentPermissionMode, target?: AgentConversationTarget) => Promise<void>
  readonly respondPermission: (requestId: string, behavior: "allow" | "deny", updatedInput?: Record<string, unknown>, message?: string) => Promise<void>
  readonly cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly refresh: () => Promise<void>
}
```

Render the top-level shell exactly like the old red-box wrapper:

```tsx
return (
  <div className="relative flex h-full min-h-0 flex-col gap-0 bg-background px-2 py-2.5">
    <TooltipProvider>
      <div className="flex items-center justify-between gap-2 px-0 py-0">
        {/* workspace header controls */}
      </div>
    </TooltipProvider>
    {/* error, timeline, and composer */}
  </div>
)
```

For the detached button use:

```tsx
{mode === "embedded" && onOpenDetached ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!session}
        onClick={() => onOpenDetached(target)}
        aria-label="新窗口打开"
      >
        <ExternalLink />
      </Button>
    </TooltipTrigger>
    <TooltipContent>新窗口打开</TooltipContent>
  </Tooltip>
) : null}
```

- [ ] **Step 4: Replace inline UI in AgentModule**

In `desktop/src/modules/agent/index.tsx`:

- keep sidebar, source filter, pending session handoff, session CRUD, project resolution.
- remove red-box local states/handlers moved to workspace.
- compute `selectedTarget` from `selectedSession`.
- pass `chat` directly as the controller because `useAgentChat` now matches the workspace method signatures.

Use:

```tsx
const selectedTarget = selectedSession
  ? {
      projectId: selectedSession.projectId,
      conversationId: selectedSession.id,
      sessionKey: selectedSession.sessionKey,
    }
  : undefined
```

Render:

```tsx
{selectedSession && selectedTarget ? (
  <AgentConversationWorkspace
    session={selectedSession}
    project={selectedProject}
    target={selectedTarget}
    chat={chat}
    quickInputs={config.global.quickInputs ?? []}
    commands={mergedCommands}
    providers={chat.providers}
    currentConversationModel={chat.currentConversationModel}
    displayProfile={selectedDisplayProfile}
    agentIcon={selectedAgentDefinition?.icon}
    mode="embedded"
    onOpenDetached={handleOpenDetachedConversation}
  />
) : (
  <div className="flex flex-1 items-center justify-center">
    <p className="text-sm text-muted-foreground">请创建新的会话</p>
  </div>
)}
```

- [ ] **Step 5: Run workspace and existing agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-conversation-workspace.test.tsx src/modules/agent/__tests__/pending-agent-session.test.tsx src/modules/agent/components/__tests__/agent-message-event.test.tsx
```

Expected: PASS. Update snapshots/assertions only when they refer to moved markup, not behavior.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/agent-conversation-workspace.tsx desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/agent-conversation-workspace.test.tsx desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
git commit -m "feat(agent): extract conversation workspace"
```

## Task 7: Main Window Detached Placeholder Integration

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`

- [ ] **Step 1: Add failing main module tests**

In `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`, add coverage using the existing bridge mock:

```tsx
it("shows detached placeholder for a selected conversation opened in a window", async () => {
  mocks.bridge.agent.listDetachedConversationWindows.mockResolvedValue([{
    projectId: "project-1",
    conversationId: "conversation-1",
    sessionKey: "local:renderer",
    title: "新会话",
    windowId: 12,
    openedAt: "2026-06-17T00:00:00.000Z",
  }])
  renderAgentModuleWithSessions([sessionSummary({
    id: "conversation-1",
    projectId: "project-1",
    sessionKey: "local:renderer",
    name: "新会话",
  })])

  expect(await screen.findByText("已经在新窗口打开")).toBeInTheDocument()
  expect(screen.queryByPlaceholderText("输入消息")).toBeNull()

  fireEvent.click(screen.getByRole("button", { name: "显示窗口" }))
  expect(mocks.bridge.agent.focusConversationWindow).toHaveBeenCalledWith({
    projectId: "project-1",
    conversationId: "conversation-1",
    sessionKey: "local:renderer",
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: FAIL because `AgentModule` does not use detached state.

- [ ] **Step 3: Wire detached state into AgentModule**

In `desktop/src/modules/agent/index.tsx`, import:

```ts
import { AgentDetachedPlaceholder } from "./components/agent-detached-placeholder"
import {
  isDetachedAgentConversation,
  useDetachedAgentConversations,
} from "./hooks/use-detached-agent-conversations"
```

Inside `AgentModule`:

```ts
const detachedConversations = useDetachedAgentConversations()
const selectedDetached = isDetachedAgentConversation(detachedConversations, {
  projectId: selectedSession?.projectId,
  conversationId: selectedSession?.id,
})
```

Add handlers:

```ts
const handleOpenDetachedConversation = async (target: AgentConversationTarget) => {
  try {
    await requireSynapseBridge().agent.openConversationWindow({
      ...target,
      title: selectedSession ? sessionLabel(selectedSession) : undefined,
    })
  } catch (rawError) {
    logger.error("Agent conversation window open failed.", {
      boundary: "renderer.agent.open-conversation-window",
      projectId: target.projectId,
      conversationId: target.conversationId,
      sessionKey: target.sessionKey,
      ...errorDiagnostic(rawError),
    })
    toast("打开失败")
  }
}

const handleShowDetachedConversation = async () => {
  if (!selectedTarget) return
  try {
    const result = await requireSynapseBridge().agent.focusConversationWindow(selectedTarget)
    if (!result.focused) {
      await requireSynapseBridge().agent.openConversationWindow({
        ...selectedTarget,
        title: selectedSession ? sessionLabel(selectedSession) : undefined,
      })
    }
  } catch (rawError) {
    logger.error("Agent detached conversation focus failed.", {
      boundary: "renderer.agent.focus-conversation-window",
      projectId: selectedTarget.projectId,
      conversationId: selectedTarget.conversationId,
      sessionKey: selectedTarget.sessionKey,
      ...errorDiagnostic(rawError),
    })
    toast("打开失败")
  }
}
```

Render `AgentDetachedPlaceholder` when `selectedDetached` is true:

```tsx
{selectedDetached ? (
  <AgentDetachedPlaceholder onShowWindow={() => void handleShowDetachedConversation()} />
) : selectedSession && selectedTarget ? (
  <AgentConversationWorkspace
    session={selectedSession}
    project={selectedProject}
    target={selectedTarget}
    chat={chat}
    quickInputs={config.global.quickInputs ?? []}
    commands={mergedCommands}
    providers={chat.providers}
    currentConversationModel={chat.currentConversationModel}
    displayProfile={selectedDisplayProfile}
    agentIcon={selectedAgentDefinition?.icon}
    mode="embedded"
    onOpenDetached={(target) => void handleOpenDetachedConversation(target)}
  />
) : (
  <div className="flex flex-1 items-center justify-center">
    <p className="text-sm text-muted-foreground">请创建新的会话</p>
  </div>
)}
```

- [ ] **Step 4: Run the main module test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
git commit -m "feat(agent): show detached conversation placeholder"
```

## Task 8: Standalone Agent Conversation Window Page

**Files:**
- Create: `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`
- Create: `desktop/src/modules/agent/__tests__/agent-conversation-window-page.test.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Write failing standalone page tests**

Create `desktop/src/modules/agent/__tests__/agent-conversation-window-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentConversationWindowPage } from "../components/agent-conversation-window-page"

vi.mock("../hooks/use-agent-chat", () => ({
  useAgentChat: () => ({
    sessions: [{
      id: "conversation-1",
      projectId: "project-1",
      sessionKey: "local:renderer",
      name: "新会话",
      active: true,
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      historyCount: 0,
      mode: "default",
      agentType: "claude-code",
    }],
    archivedSessions: [],
    timeline: [],
    pendingPermissions: [],
    sending: false,
    sendingConversationIds: new Set(),
    cancelPhase: "idle",
    error: null,
    providers: null,
    commands: [],
    currentConversationModel: undefined,
    selectedProjectId: "project-1",
    selectedConversationId: "conversation-1",
    selectedSessionKey: "local:renderer",
    activeProjectId: "project-1",
    loading: false,
    createSession: vi.fn(),
    selectSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    refresh: vi.fn(),
    sendMessage: vi.fn(),
    setPermissionMode: vi.fn(),
    respondPermission: vi.fn(),
    cancelTurn: vi.fn(),
    forceKillTurn: vi.fn(),
  }),
}))

describe("AgentConversationWindowPage", () => {
  it("renders a fixed conversation workspace", async () => {
    render(<AgentConversationWindowPage request={{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    }} />)

    expect(await screen.findByText("新会话")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新窗口打开" })).toBeNull()
  })

  it("shows missing conversation state", () => {
    render(<AgentConversationWindowPage request={{
      projectId: "project-1",
      conversationId: "missing",
      sessionKey: "local:renderer",
    }} />)

    expect(screen.getByText("对话不存在或已删除")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the standalone page test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-conversation-window-page.test.tsx
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement the standalone page**

Create `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react"
import { useAppConfig } from "@/app-shell/config"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "@/lib/default-agent-workspace"
import type { AgentConversationWindowRequest } from "@/types/agent-conversation-window"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { AgentConversationWorkspace } from "./agent-conversation-workspace"
import { useAgentChat } from "../hooks/use-agent-chat"
import { resolveAgentProjectScope } from "../project-resolution"
import { getRendererPlatform } from "@/lib/runtime-platform"

const DEFAULT_AGENT_DISPLAY_PROFILE = {
  agentLabel: "Agent",
  thinkingDefaultCollapsed: false,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
} as const

function AgentConversationWindowPage({ request }: { readonly request: AgentConversationWindowRequest }) {
  const { config } = useAppConfig()
  const project = config.global.projects.find((item) => item.id === request.projectId)
    ?? (DEFAULT_AGENT_WORKSPACE_PROJECT.id === request.projectId ? DEFAULT_AGENT_WORKSPACE_PROJECT : undefined)
  const projectScope = useMemo(() => resolveAgentProjectScope(
    project,
    config.global.projects,
    getRendererPlatform(),
  ), [config.global.projects, project])
  const chat = useAgentChat(projectScope)
  const selectedRef = useRef(false)
  const session = [...chat.sessions, ...chat.archivedSessions].find((item) =>
    item.projectId === request.projectId
    && item.id === request.conversationId
    && item.sessionKey === request.sessionKey)

  useEffect(() => {
    if (!session || selectedRef.current) return
    selectedRef.current = true
    void chat.selectSession(session)
  }, [chat, session])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">项目不存在或已删除</p>
      </div>
    )
  }

  if (!session && !chat.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">对话不存在或已删除</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">加载中</p>
      </div>
    )
  }

  const definition = agentDefinitions.find((item) => item.id === session.agentType)
  const target = {
    projectId: session.projectId,
    conversationId: session.id,
    sessionKey: session.sessionKey,
  }

  return (
    <AgentConversationWorkspace
      session={session}
      project={project}
      target={target}
      chat={chat}
      quickInputs={config.global.quickInputs ?? []}
      commands={[...(definition?.commands ?? []), ...(chat.commands ?? [])]}
      providers={chat.providers}
      currentConversationModel={chat.currentConversationModel}
      displayProfile={definition?.displayProfile ?? DEFAULT_AGENT_DISPLAY_PROFILE}
      agentIcon={definition?.icon}
      mode="window"
    />
  )
}

export { AgentConversationWindowPage }
```

- [ ] **Step 4: Route the standalone page in App**

In `desktop/src/App.tsx`, import:

```ts
import { parseAgentConversationWindowRequest } from "@/lib/agent-conversation-window"
import { AgentConversationWindowPage } from "@/modules/agent/components/agent-conversation-window-page"
```

Add state:

```ts
const [agentConversationWindowRequest, setAgentConversationWindowRequest] =
  useState<ReturnType<typeof parseAgentConversationWindowRequest>>(null)
```

Parse in the existing `useEffect`:

```ts
setAgentConversationWindowRequest(parseAgentConversationWindowRequest(window.location.search))
```

Render before other standalone `synapseWindow` pages:

```tsx
if (agentConversationWindowRequest) {
  return (
    <IdentityGate>
      <ErrorBoundary fallbackTitle="对话窗口出现问题">
        <AgentConversationWindowPage request={agentConversationWindowRequest} />
      </ErrorBoundary>
    </IdentityGate>
  )
}
```

- [ ] **Step 5: Run standalone page tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-conversation-window-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/agent-conversation-window-page.tsx desktop/src/modules/agent/__tests__/agent-conversation-window-page.test.tsx desktop/src/App.tsx
git commit -m "feat(agent): render conversation workspace window"
```

## Task 9: Release Notes And Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

In `RELEASE_NOTES_PENDING.md`, add this bullet under the first existing user-facing section:

```md
- Agent 对话支持在独立窗口中固定打开；主界面再次选中该对话时会提示已在新窗口打开，并可一键显示窗口。
```

- [ ] **Step 2: Run focused validation**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-window.test.ts src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx src/modules/agent/__tests__/detached-agent-conversations.test.tsx src/modules/agent/__tests__/agent-conversation-workspace.test.tsx src/modules/agent/__tests__/agent-conversation-window-page.test.tsx electron/services/__tests__/agent-conversation-window-service.test.ts electron/modules/agent/__tests__/ipc-sessions.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent conversation windows"
```

- [ ] **Step 5: Manual verification**

Run the desktop app with the existing root command:

```bash
pnpm dev:desktop
```

Verify:

- The Agent toolbar shows a new window icon to the right of export.
- Clicking it opens a new standalone window for the current conversation.
- Re-clicking the icon focuses the existing standalone window.
- Main window shows “已经在新窗口打开” and “显示窗口” for the detached conversation.
- Clicking “显示窗口” focuses the standalone window.
- Closing the standalone window restores the full conversation workspace in the main window.
- Sending, permission handling, cancel, copy, export, and reference opening work in the standalone window.
