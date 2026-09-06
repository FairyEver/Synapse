/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SynapseAgentDomainEvent,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
  SynapseAgentTimelineResult,
} from "@/types/agent"
import { useAgentChat } from "../use-agent-chat"
import { createImageAttachment, createPathAttachment } from "../../attachments"
import type { AgentProjectScope } from "../../project-resolution"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(() => "blob:optimistic-agent-image"),
})
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
})

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

const session: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "conversation-1",
  sessionKey: "local:renderer",
  active: true,
  historyCount: 0,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
}

const nextSession: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "conversation-2",
  sessionKey: "local:renderer",
  active: false,
  historyCount: 0,
  createdAt: "2026-05-13T00:01:00.000Z",
  updatedAt: "2026-05-13T00:01:00.000Z",
}

const scheduledSession: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "scheduled-conversation-1",
  sessionKey: "scheduled:project-1:123",
  platform: "scheduled",
  active: true,
  historyCount: 1,
  createdAt: "2026-05-13T00:03:00.000Z",
  updatedAt: "2026-05-13T00:03:00.000Z",
}

const projectScope: AgentProjectScope = {
  projectIds: ["project-1"],
  defaultProjectId: "project-1",
}

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.debug.mockClear()
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  ;(window as unknown as { synapse?: unknown }).synapse = {
    agent: {
      getProviders: vi.fn(async () => ({ agentType: "claude-code", providers: [] })),
      getTimeline: vi.fn(async () => ({
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: [],
        total: 0,
        startIndex: 0,
        hasMore: false,
      })),
      cancelTurn: vi.fn(async () => ({ status: "cancelled" })),
      createSession: vi.fn(async () => ({
        ...nextSession,
        active: true,
      })),
      deleteSession: vi.fn(async () => ({ ok: true })),
      forceKillTurn: vi.fn(async () => undefined),
      listAllSessions: vi.fn(async () => [session]),
      listCommands: vi.fn(async () => []),
      listPendingPermissions: vi.fn(async () => []),
      listSessions: vi.fn(async () => [session]),
      onEvent: vi.fn(() => () => {}),
      respondPermission: vi.fn(async () => undefined),
      setPermissionMode: vi.fn(async () => ({ ...session, mode: "plan" })),
      send: vi.fn(async () => {
        throw new Error("enqueue failed with prompt=secret")
      }),
      status: vi.fn(async () => ({
        projectId: session.projectId,
        projectName: "Project One",
        agentType: "claude-code",
        liveSessions: 1,
        busySessions: 0,
        queuedTurns: 0,
        pendingPermissions: 0,
      })),
      switchSession: vi.fn(async () => session),
    },
    agentPersonas: {
      list: vi.fn(async () => ({
        status: "online",
        items: [{
          id: "builtin-zh-en-translator",
          schemaVersion: 1,
          name: "中英翻译",
          description: "在中文和英文之间互译。",
          systemPrompt: "你是中英翻译智能体。",
          providerModel: null,
          toolPolicy: { mode: "disabled" },
          source: "builtin",
          readonly: true,
          version: 1,
        }],
      })),
      onChanged: vi.fn(() => () => {}),
    },
  }
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
})

describe("useAgentChat", () => {
  it("loads the latest page once and prepends an older page without duplicates", async () => {
    const bridge = (window as unknown as {
      synapse: { agent: { getTimeline: ReturnType<typeof vi.fn> } }
    }).synapse.agent
    let failOlder = true
    bridge.getTimeline.mockImplementation(async (request: { beforeIndex?: number }) => {
      if (request.beforeIndex === 100) {
        if (failOlder) throw new Error("older failed")
        return {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          entries: Array.from({ length: 100 }, (_, index) => timelineHistoryMessage(index)),
          total: 102,
          startIndex: 0,
          hasMore: false,
        }
      }
      return {
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: [timelineHistoryMessage(100), timelineHistoryMessage(101)],
        total: 102,
        startIndex: 100,
        hasMore: true,
      }
    })

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.timeline.length === 2)

    await act(async () => {
      await chat?.loadOlderTimeline()
    })
    expect(chat?.timelineHistoryError).toBe("历史加载失败")
    failOlder = false
    const olderCallsBeforeRetry = bridge.getTimeline.mock.calls.filter(([request]) => request.beforeIndex === 100).length
    await act(async () => {
      await Promise.all([chat?.loadOlderTimeline(), chat?.loadOlderTimeline()])
    })

    expect(chat?.timeline).toHaveLength(102)
    expect(new Set(chat?.timeline.map((item) => item.id)).size).toBe(102)
    expect(chat?.timeline[0]?.id).toBe(`${session.id}:history:0`)
    expect(chat?.timeline.at(-1)?.id).toBe(`${session.id}:history:101`)
    expect(chat?.timelineHasMore).toBe(false)
    expect(bridge.getTimeline.mock.calls.filter(([request]) => request.beforeIndex === 100)).toHaveLength(olderCallsBeforeRetry + 1)
    expect(chat?.timelineHistoryError).toBeNull()
  })

  it("keeps the loaded prefix and active phase when a persisted tail refresh follows compaction", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          onEvent: ReturnType<typeof vi.fn>
          send: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    let latest = false
    bridge.getTimeline.mockImplementation(async () => latest
      ? {
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: [
          { ...timelineHistoryMessage(1), content: "persisted replacement" },
          timelineHistoryMessage(2),
          { ...timelineHistoryMessage(3), role: "user" as const, content: "persist me" },
        ],
        total: 4,
        startIndex: 1,
        hasMore: true,
      }
      : {
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: [timelineHistoryMessage(0), timelineHistoryMessage(1), timelineHistoryMessage(2)],
        total: 3,
        startIndex: 0,
        hasMore: false,
      })
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.timeline.length === 3)

    await act(async () => {
      bridge.send.mockResolvedValueOnce({ queued: true })
      await chat?.sendMessage("persist me")
      emitAgentEvent?.({
        domain: "agent",
        type: "stream",
        timestamp: "2026-08-03T00:00:59.000Z",
        scope: { projectId: session.projectId, sessionId: session.id },
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          platform: "local-renderer",
          event: { type: "text", content: "persist me" },
        },
      })
      emitAgentEvent?.({
        domain: "agent",
        type: "stream",
        timestamp: "2026-08-03T00:01:00.000Z",
        scope: { projectId: session.projectId, sessionId: session.id },
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          platform: "local-renderer",
          event: {
            type: "compactBoundary",
            contextUsage: {
              usedTokens: 12_000,
              contextWindowTokens: 200_000,
              model: "claude-sonnet-4-5",
            },
          },
        },
      })
      emitAgentEvent?.({
        domain: "agent",
        type: "phase.update",
        timestamp: "2026-08-03T00:01:01.000Z",
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          runId: "run-refresh",
          phase: "runtime_starting",
          status: "in-progress",
          startedAt: "2026-08-03T00:01:01.000Z",
        },
      })
    })
    expect(chat?.timeline.some((item) => item.kind === "sdkEvent" && item.sdkType === "compactBoundary")).toBe(true)
    expect(chat?.contextUsage).toEqual({
      usedTokens: 12_000,
      contextWindowTokens: 200_000,
      model: "claude-sonnet-4-5",
    })
    expect(chat?.timeline.some((item) => item.id.startsWith("local:"))).toBe(true)

    latest = true
    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "conversationUpdated",
        timestamp: "2026-08-03T00:01:02.000Z",
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          platform: "local-renderer",
        },
      })
    })
    await waitFor(() => chat?.timeline.some((item) => item.id === `${session.id}:history:3`) === true)

    expect(chat?.timeline.some((item) => item.id === `${session.id}:history:0`)).toBe(true)
    expect(chat?.timeline).toContainEqual(expect.objectContaining({
      id: `${session.id}:history:1`,
      content: "persisted replacement",
    }))
    expect(chat?.timeline.filter((item) => item.kind === "phase" && item.runId === "run-refresh")).toHaveLength(1)
    expect(chat?.timeline.some((item) => item.id.startsWith("local:"))).toBe(false)
    expect(chat?.timeline.filter((item) => item.kind === "message" && item.content === "persist me")).toHaveLength(1)
    expect(chat?.timeline.some((item) => item.kind === "sdkEvent" && item.sdkType === "compactBoundary")).toBe(false)
    expect(chat?.contextUsage?.usedTokens).toBe(12_000)
    expect(chat?.timelineHasMore).toBe(false)

    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "stream",
        timestamp: "2026-08-03T00:01:03.000Z",
        scope: { projectId: session.projectId, sessionId: session.id },
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          platform: "local-renderer",
          event: { type: "compactBoundary" },
        },
      })
    })
    expect(chat?.contextUsage).toBeUndefined()
  })

  it("does not let a stale tail refresh overwrite a newer live event", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          onEvent: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    let resolveRefresh: ((value: ReturnType<typeof timelineResult>) => void) | undefined
    let timelineCallCount = 0
    bridge.getTimeline.mockImplementation(() => {
      timelineCallCount += 1
      if (timelineCallCount === 1) return Promise.resolve(timelineResult([{
        ...timelineHistoryMessage(0),
        role: "user" as const,
        content: "question",
      }]))
      return new Promise((resolve) => {
        resolveRefresh = resolve
      })
    })
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => {
      const first = chat?.timeline[0]
      return first?.kind === "message" && first.content === "question"
    })

    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "conversationUpdated",
        timestamp: "2026-08-11T00:00:01.000Z",
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          platform: "local-renderer",
        },
      })
      await Promise.resolve()
      emitAgentEvent?.({
        domain: "agent",
        type: "assistant",
        timestamp: "2026-08-11T00:00:02.000Z",
        scope: { projectId: session.projectId, sessionId: session.id },
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          platform: "local-renderer",
          sequence: 2,
          event: { type: "assistant", content: "live answer" },
        },
      })
    })
    expect(chat?.timeline.some((item) => item.kind === "message" && item.content === "live answer")).toBe(true)

    await act(async () => {
      resolveRefresh?.(timelineResult([{
        ...timelineHistoryMessage(0),
        role: "user" as const,
        content: "question",
      }]))
      await Promise.resolve()
    })

    expect(chat?.timeline.some((item) => item.kind === "message" && item.content === "live answer")).toBe(true)
  })

  it("replaces pagination state when switching conversations", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
          switchSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listSessions.mockResolvedValue([session, nextSession])
    bridge.switchSession.mockResolvedValue({ ...nextSession, active: true })
    bridge.getTimeline.mockImplementation(async (request: { conversationId?: string }) => {
      const selectedId = request.conversationId ?? session.id
      const selectedSession = selectedId === nextSession.id ? nextSession : session
      return {
        projectId: selectedSession.projectId,
        sessionKey: selectedSession.sessionKey,
        conversationId: selectedSession.id,
        entries: [{
          ...timelineHistoryMessage(0),
          id: `${selectedSession.id}:history:0`,
          content: selectedSession.id,
        }],
        total: selectedSession.id === nextSession.id ? 1 : 101,
        startIndex: selectedSession.id === nextSession.id ? 0 : 100,
        hasMore: selectedSession.id !== nextSession.id,
      }
    })

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.timeline[0]?.id === `${session.id}:history:0`)
    expect(chat?.timelineHasMore).toBe(true)

    await act(async () => {
      await chat?.selectSession(nextSession)
    })

    expect(chat?.selectedConversationId).toBe(nextSession.id)
    expect(chat?.timeline.map((item) => item.id)).toEqual([`${nextSession.id}:history:0`])
    expect(chat?.timelineHasMore).toBe(false)
  })

  it("backfills missing pages before merging a live tail refresh", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          onEvent: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    let refreshStarted = false
    bridge.getTimeline.mockImplementation(async (request: { beforeIndex?: number }) => {
      if (!refreshStarted) {
        return {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          entries: Array.from({ length: 50 }, (_, offset) => timelineHistoryMessage(50 + offset)),
          total: 100,
          startIndex: 50,
          hasMore: true,
        }
      }
      if (request.beforeIndex === 200) {
        return {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          entries: Array.from({ length: 100 }, (_, offset) => timelineHistoryMessage(100 + offset)),
          total: 250,
          startIndex: 100,
          hasMore: true,
        }
      }
      return {
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: Array.from({ length: 50 }, (_, offset) => timelineHistoryMessage(200 + offset)),
        total: 250,
        startIndex: 200,
        hasMore: true,
      }
    })
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.timeline.length === 50)

    refreshStarted = true
    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "conversationUpdated",
        timestamp: "2026-08-03T00:02:00.000Z",
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          platform: "local-renderer",
        },
      })
    })
    await waitFor(() => chat?.timeline.at(-1)?.id === `${session.id}:history:249`)

    expect(chat?.timeline).toHaveLength(200)
    expect(chat?.timeline.map((item) => item.id)).toEqual(
      Array.from({ length: 200 }, (_, offset) => `${session.id}:history:${String(50 + offset)}`),
    )
    expect(bridge.getTimeline).toHaveBeenCalledWith(expect.objectContaining({ beforeIndex: 200 }))
  })

  it("requests a bounded archived-session summary window outside configured projects", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listAllSessions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={() => {}} />)
    })
    await waitFor(() => bridge.listAllSessions.mock.calls.length > 0)

    expect(bridge.listAllSessions).toHaveBeenCalledWith({
      excludeProjectIds: ["project-1"],
      limit: 200,
    })
  })

  it("loads new-conversation personas from an offline cache result", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agentPersonas: {
          list: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agentPersonas
    bridge.list.mockResolvedValue({
      status: "offline-cache",
      syncedAt: "2026-07-01T00:00:00.000Z",
      items: [cachedPersona()],
    })
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
    await waitFor(() => chat?.personas[0]?.id === "persona-cache")

    expect(chat?.personas.map((item) => item.id)).toEqual(["persona-cache"])
  })

  it("finishes persona loading with an empty list when no cache is available", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agentPersonas: {
          list: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agentPersonas
    bridge.list.mockRejectedValue(new Error("offline without cache"))
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.personasLoaded === true)

    expect(chat?.personas).toEqual([])
  })

  it("passes the selected persona when creating a session", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
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
      await chat?.createSession(
        "project-1",
        "anthropic",
        undefined,
        "sonnet",
        "新对话",
        "builtin-zh-en-translator",
      )
    })

    expect(bridge.createSession).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionKey: "local:renderer",
      agentType: "claude-code",
      providerId: "anthropic",
      modelTier: "sonnet",
      name: "新对话",
      mode: undefined,
      personaId: "builtin-zh-en-translator",
    })
  })

  it("removes the optimistic local user message when send enqueue fails", async () => {
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

    const sent = await act(async () =>
      chat?.sendMessage("hello", {
        projectId: session.projectId,
        conversationId: session.id,
        sessionKey: session.sessionKey,
      }))

    expect(sent).toBe(false)
    expect(chat?.error).toBe("发送失败")
    expect(chat?.timeline).toEqual([])
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent send failed.", expect.objectContaining({
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
      messageLength: "hello".length,
      boundary: "renderer.agent.send",
      errorName: "Error",
      errorLength: "enqueue failed with prompt=secret".length,
    }))
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("prompt=secret")
  })

  it("treats a resolved send result with an error as a failed send", async () => {
    const bridge = (window as unknown as {
      synapse: { agent: { send: ReturnType<typeof vi.fn> } }
    }).synapse.agent
    bridge.send.mockResolvedValue({
      conversationId: session.id,
      resultText: "",
      events: [],
      error: "SDK 发送失败",
    })
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.selectedConversationId === session.id)

    const sent = await act(async () => chat?.sendMessage("/review-code", {
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
    }))

    expect(sent).toBe(false)
    expect(chat?.error).toBe("发送失败")
    expect(chat?.timeline).toEqual([])
  })

  it("keeps a user-stopped send accepted instead of surfacing a send failure", async () => {
    const bridge = (window as unknown as {
      synapse: { agent: { send: ReturnType<typeof vi.fn> } }
    }).synapse.agent
    bridge.send.mockResolvedValue({
      conversationId: session.id,
      resultText: "",
      error: "已停止本次执行。",
      events: [{
        type: "result",
        content: "",
        done: true,
        metadata: { cancelled: true },
      }],
    })
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.selectedConversationId === session.id)

    const sent = await act(async () => chat?.sendMessage("stop me", {
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
    }))

    expect(sent).toBe(true)
    expect(chat?.error).toBeNull()
    expect(chat?.timeline).toHaveLength(1)
    expect(chat?.timeline[0]).toMatchObject({ kind: "message", role: "user", content: "stop me" })
  })

  it("keeps a recoverable interrupted send accepted", async () => {
    const bridge = (window as unknown as {
      synapse: { agent: { send: ReturnType<typeof vi.fn> } }
    }).synapse.agent
    bridge.send.mockResolvedValue({
      conversationId: session.id,
      resultText: "",
      error: "模型连接中断，任务尚未完成。",
      events: [{
        type: "error",
        message: "模型连接中断，任务尚未完成。",
        errorKind: "connection_interrupted",
        recoverable: true,
      }],
    })
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { chat = next }} />)
    })
    await waitFor(() => chat?.selectedConversationId === session.id)

    const sent = await act(async () => chat?.sendMessage("continue later", {
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
    }))

    expect(sent).toBe(true)
    expect(chat?.error).toBeNull()
    expect(chat?.timeline).toHaveLength(1)
    expect(chat?.timeline[0]).toMatchObject({
      kind: "message",
      role: "user",
      content: "continue later",
    })
  })

  it("shows safe attachment send errors without keeping the optimistic message", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          send: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.send.mockRejectedValue(new Error("附件路径不存在。"))
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

    const sent = await act(async () =>
      chat?.sendMessage("", {
        projectId: session.projectId,
        conversationId: session.id,
        sessionKey: session.sessionKey,
      }, {
        attachments: [createPathAttachment({
          id: "file-1",
          path: "/Users/liyang/Desktop/missing.md",
          entryType: "file",
        })],
      }))

    expect(sent).toBe(false)
    expect(chat?.error).toBe("附件路径不存在。")
    expect(chat?.timeline).toEqual([])
  })

  it("tracks pending background conversations for phase filtering", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          onEvent: ReturnType<typeof vi.fn>
          send: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.send.mockResolvedValue(undefined)
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })
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
      await chat?.sendMessage("hello", {
        projectId: nextSession.projectId,
        conversationId: nextSession.id,
        sessionKey: nextSession.sessionKey,
      })
      emitAgentEvent?.({
        domain: "agent",
        type: "phase.update",
        timestamp: "2026-05-13T00:02:00.000Z",
        payload: {
          projectId: nextSession.projectId,
          sessionKey: nextSession.sessionKey,
          conversationId: nextSession.id,
          runId: "run-background",
          phase: "received",
          status: "in-progress",
          startedAt: "2026-05-13T00:02:00.000Z",
        },
      })
    })

    expect(rendererLogger.debug).toHaveBeenCalledWith(
      "Phase event ignored for inactive conversation.",
      expect.objectContaining({
        conversationId: nextSession.id,
        pendingConversation: true,
      }),
    )
  })

  it("shows attachment-only images optimistically while sending only attachment refs", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          send: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.send.mockResolvedValue(undefined)
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

    const sent = await act(async () =>
      chat?.sendMessage("", {
        projectId: session.projectId,
        conversationId: session.id,
        sessionKey: session.sessionKey,
      }, {
        attachments: [
          createImageAttachment({
            id: "img-1",
            mimeType: "image/png",
            name: "screen.png",
            size: 3,
            previewUrl: "synapse-agent-artifact://local/img-1/preview",
            thumbnailUrl: "synapse-agent-artifact://local/img-1/thumbnail",
          }),
        ],
      }))

    expect(sent).toBe(true)
    expect(chat?.timeline.at(-1)).toMatchObject({
      kind: "message",
      role: "user",
      content: "",
      attachments: [expect.objectContaining({
        kind: "image",
        name: "screen.png",
        url: "synapse-agent-artifact://local/img-1/preview",
      })],
    })
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
      content: "",
      displayContent: "",
      attachments: [{
        attachmentId: "img-1",
        order: 0,
      }],
    }))
    expect(JSON.stringify(bridge.send.mock.calls)).not.toContain("base64")
    await act(async () => root.unmount())
    roots = roots.filter((candidate) => candidate !== root)
  })

  it("sends path attachments as refs without rewriting the user content", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          send: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.send.mockResolvedValue(undefined)
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

    const sent = await act(async () =>
      chat?.sendMessage("请分析", {
        projectId: session.projectId,
        conversationId: session.id,
        sessionKey: session.sessionKey,
      }, {
        attachments: [
          createPathAttachment({
            id: "file-1",
            path: "/Users/liyang/Desktop/brief.md",
            entryType: "file",
          }),
          createPathAttachment({
            id: "dir-1",
            path: "/Users/liyang/Downloads/materials",
            entryType: "directory",
          }),
        ],
      }))

    expect(sent).toBe(true)
    expect(chat?.timeline.at(-1)).toMatchObject({
      kind: "message",
      role: "user",
      content: "请分析",
      attachments: [
        expect.objectContaining({ kind: "path", name: "brief.md" }),
        expect.objectContaining({ kind: "path", name: "materials" }),
      ],
    })
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
      content: "请分析",
      displayContent: "请分析",
      attachments: [
        {
          attachmentId: "file-1",
          order: 0,
        },
        {
          attachmentId: "dir-1",
          order: 1,
        },
      ],
    }))
  })

  it("marks selected automated conversations as sending while their phase is in progress", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
          onEvent: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listSessions.mockResolvedValue([scheduledSession])
    bridge.getTimeline.mockResolvedValue({
      projectId: scheduledSession.projectId,
      sessionKey: scheduledSession.sessionKey,
      conversationId: scheduledSession.id,
      entries: [],
      total: 0,
      startIndex: 0,
      hasMore: false,
    })
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })
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
    await waitFor(() => chat?.selectedConversationId === scheduledSession.id)

    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "phase.update",
        timestamp: "2026-05-13T00:04:00.000Z",
        payload: {
          projectId: scheduledSession.projectId,
          sessionKey: scheduledSession.sessionKey,
          conversationId: scheduledSession.id,
          runId: "run-scheduled",
          phase: "received",
          status: "in-progress",
          startedAt: "2026-05-13T00:04:00.000Z",
        },
      })
    })

    expect(chat?.sending).toBe(true)
    expect(chat?.sendingConversationIds.has(scheduledSession.id)).toBe(true)

    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "phase.update",
        timestamp: "2026-05-13T00:04:10.000Z",
        payload: {
          projectId: scheduledSession.projectId,
          sessionKey: scheduledSession.sessionKey,
          conversationId: scheduledSession.id,
          runId: "run-scheduled",
          phase: "completed",
          status: "done",
          startedAt: "2026-05-13T00:04:00.000Z",
          completedAt: "2026-05-13T00:04:10.000Z",
        },
      })
    })

    expect(chat?.sending).toBe(false)
    expect(chat?.sendingConversationIds.has(scheduledSession.id)).toBe(false)
  })

  it("keeps the selected conversation stoppable when SDK stream events arrive without a phase update", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          onEvent: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    let emitAgentEvent: ((event: SynapseAgentDomainEvent) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })
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
    expect(chat?.sending).toBe(false)

    await act(async () => {
      emitAgentEvent?.({
        domain: "agent",
        type: "stream",
        timestamp: "2026-05-13T00:05:00.000Z",
        scope: { projectId: session.projectId, sessionId: session.id },
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          platform: "local-renderer",
          event: {
            type: "toolUse",
            toolName: "TodoWrite",
            toolInput: "{\"todos\":[]}",
            timestamp: "2026-05-13T00:05:00.000Z",
          },
        },
      })
    })

    expect(chat?.sending).toBe(true)
    expect(chat?.sendingConversationIds.has(session.id)).toBe(true)
  })

  it("logs archived session refresh failures without exposing the error message", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listAllSessions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listAllSessions.mockRejectedValue(new Error("archive secret failure"))
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

    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent archived sessions refresh failed.", expect.objectContaining({
      projectIds: ["project-1"],
      errorName: "Error",
      errorLength: "archive secret failure".length,
    }))
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("archive secret failure")
  })

  it("keeps the selected session when pending permission refresh fails", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          listPendingPermissions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listPendingPermissions.mockRejectedValue(new Error("permission refresh token=sk-permission"))
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

    expect(chat?.error).toBe("权限刷新失败")
    expect(bridge.getTimeline).toHaveBeenCalledWith({
      projectId: session.projectId,
      sessionKey: session.sessionKey,
      conversationId: session.id,
      limit: 100,
    })
    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent pending permissions refresh failed.", expect.objectContaining({
      projectIds: ["project-1"],
      activeProjectId: session.projectId,
      boundary: "renderer.agent.pending-permissions",
      errorName: "Error",
      errorLength: "permission refresh token=sk-permission".length,
    }))
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("sk-permission")
  })

  it("logs Agent refresh failures with sanitized target context", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listSessions: ReturnType<typeof vi.fn>
          onEvent: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    let emitAgentEvent: ((event: {
      readonly type: "conversationUpdated"
      readonly timestamp: string
      readonly payload: {
        readonly projectId: string
        readonly sessionKey: string
        readonly conversationId: string
      }
    }) => void) | undefined
    bridge.onEvent.mockImplementation((callback) => {
      emitAgentEvent = callback
      return () => {}
    })
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

    bridge.listSessions.mockRejectedValue(new Error("refresh failed token=sk-refresh /Users/liyang/project"))

    await act(async () => {
      emitAgentEvent?.({
        type: "conversationUpdated",
        timestamp: "2026-05-13T00:02:00.000Z",
        payload: {
          projectId: session.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
        },
      })
    })
    await waitFor(() => rendererLogger.error.mock.calls.some((call) => call[0] === "Agent conversation refresh failed."))

    expect(rendererLogger.error).toHaveBeenCalledWith("Agent conversation refresh failed.", {
      projectId: session.projectId,
      targetConversationId: session.id,
      targetSessionKey: session.sessionKey,
      boundary: "renderer.agent.conversation-refresh",
      errorName: "Error",
      errorLength: "refresh failed token=sk-refresh /Users/liyang/project".length,
    })
    expect(chat?.error).toBe("刷新会话失败")

    rendererLogger.error.mockClear()

    await act(async () => {
      await chat?.refresh()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("Agent refresh failed.", {
      projectIds: ["project-1"],
      selectedProjectId: session.projectId,
      selectedConversationId: session.id,
      boundary: "renderer.agent.refresh",
      errorName: "Error",
      errorLength: "refresh failed token=sk-refresh /Users/liyang/project".length,
    })
    expect(chat?.error).toBe("加载失败")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-refresh")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/liyang")
  })

  it("clears the selected timeline when refresh finds no remaining sessions", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.getTimeline.mockImplementation(async (request: { conversationId?: string }) => ({
      projectId: session.projectId,
      sessionKey: session.sessionKey,
      conversationId: request.conversationId,
      entries: request.conversationId ? [] : [{
        id: "stale-message",
        kind: "message",
        role: "assistant",
        content: "stale content",
        timestamp: "2026-05-13T00:03:00.000Z",
      }],
      total: request.conversationId ? 0 : 1,
      startIndex: 0,
      hasMore: false,
    }))

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

    bridge.listSessions.mockResolvedValue([])

    await act(async () => {
      await chat?.refresh()
    })

    expect(chat?.sessions).toEqual([])
    expect(chat?.selectedConversationId).toBeUndefined()
    expect(chat?.timeline).toEqual([])
    expect(bridge.getTimeline).not.toHaveBeenCalledWith(expect.objectContaining({
      conversationId: undefined,
    }))
  })

  it("clears the selected timeline after concurrent deletes remove every session", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          deleteSession: ReturnType<typeof vi.fn>
          getTimeline: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    const deletes = new Map<string, () => void>()
    bridge.listSessions.mockResolvedValue([session, nextSession])
    bridge.getTimeline.mockResolvedValue({
      projectId: session.projectId,
      sessionKey: session.sessionKey,
      conversationId: session.id,
      entries: [{
        id: "existing-message",
        kind: "message",
        role: "assistant",
        content: "existing content",
        timestamp: "2026-05-13T00:03:00.000Z",
      }],
      total: 1,
      startIndex: 0,
      hasMore: false,
    })
    bridge.deleteSession.mockImplementation(({ conversationId }: { conversationId: string }) =>
      new Promise<{ ok: true }>((resolve) => {
        deletes.set(conversationId, () => resolve({ ok: true }))
      }))

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

    let deleteSelected: Promise<void> | undefined
    let deleteNext: Promise<void> | undefined
    await act(async () => {
      deleteSelected = chat?.deleteSession(session)
      deleteNext = chat?.deleteSession(nextSession)
      await Promise.resolve()
    })

    bridge.listSessions.mockResolvedValue([])

    await act(async () => {
      deletes.get(nextSession.id)?.()
      deletes.get(session.id)?.()
      await Promise.all([deleteSelected, deleteNext])
    })
    await waitFor(() => chat?.sessions.length === 0)

    expect(chat?.selectedConversationId).toBeUndefined()
    expect(chat?.timeline).toEqual([])
  })

  it("returns the created session while preserving the create selection flow", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    const createdSession: SynapseAgentSessionSummary = {
      ...nextSession,
      id: "conversation-created",
      name: "新会话 10:00 AM",
      active: true,
    }
    bridge.createSession.mockResolvedValue(createdSession)
    bridge.listSessions
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([session, createdSession])

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

    let created: SynapseAgentSessionSummary | undefined
    await act(async () => {
      created = await chat?.createSession(
        session.projectId,
        "provider-1",
        "acceptEdits",
        "sonnet",
      )
    })

    expect(created).toEqual(createdSession)
    expect(chat?.selectedConversationId).toBe(createdSession.id)
    expect(chat?.selectedSessionKey).toBe(createdSession.sessionKey)
    expect(chat?.timeline).toEqual([])
    expect(bridge.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: session.projectId,
      sessionKey: "local:renderer",
      providerId: "provider-1",
      mode: "acceptEdits",
      modelTier: "sonnet",
    }))
  })

  it("refreshes selection when delete fallback switch fails", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          getTimeline: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
          switchSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listSessions
      .mockResolvedValueOnce([session, nextSession])
      .mockResolvedValue([])
    bridge.switchSession.mockRejectedValue(new Error("switch internal detail"))

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
      await chat?.deleteSession(session)
    })

    expect(chat?.selectedConversationId).toBeUndefined()
    expect(chat?.timeline).toEqual([])
    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent delete fallback switch failed.", expect.objectContaining({
      projectId: nextSession.projectId,
      conversationId: nextSession.id,
      sessionKey: nextSession.sessionKey,
      errorName: "Error",
      errorLength: "switch internal detail".length,
    }))
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("switch internal detail")
  })

  it("logs permission response failures with sanitized request context", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listPendingPermissions: ReturnType<typeof vi.fn>
          respondPermission: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listPendingPermissions.mockResolvedValue([{
      requestId: "permission-1",
      projectId: session.projectId,
      sessionKey: session.sessionKey,
      conversationId: session.id,
      toolName: "Bash",
      createdAt: "2026-05-13T00:02:00.000Z",
    }])
    bridge.respondPermission.mockRejectedValue(new Error("permission secret token=sk-test"))

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
    await waitFor(() => chat?.pendingPermissions.length === 1)

    let responseError: unknown
    await act(async () => {
      try {
        await chat?.respondPermission({
          projectId: session.projectId,
          requestId: "permission-1",
        }, "allow")
      } catch (error) {
        responseError = error
      }
    })

    expect(responseError).toBeInstanceOf(Error)
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent permission response failed.", expect.objectContaining({
      projectId: session.projectId,
      requestId: "permission-1",
      behavior: "allow",
      boundary: "renderer.agent.permission-response",
      errorName: "Error",
      errorLength: "permission secret token=sk-test".length,
    }))
    expect(chat?.error).toBe("处理失败")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("permission secret token")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-test")
  })

  it("clears stale pending permissions when a permission response is no longer pending", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listPendingPermissions: ReturnType<typeof vi.fn>
          respondPermission: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listPendingPermissions
      .mockResolvedValueOnce([{
        requestId: "permission-1",
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        toolName: "ExitPlanMode",
        createdAt: "2026-05-13T00:02:00.000Z",
      }])
      .mockResolvedValueOnce([])
    bridge.respondPermission.mockRejectedValue(new Error("该权限请求已不在等待中。"))

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
    await waitFor(() => chat?.pendingPermissions.length === 1)

    let responseError: unknown
    await act(async () => {
      try {
        await chat?.respondPermission({
          projectId: session.projectId,
          requestId: "permission-1",
        }, "allow")
      } catch (error) {
        responseError = error
      }
    })

    expect(responseError).toBeInstanceOf(Error)
    expect(chat?.pendingPermissions).toEqual([])
    expect(chat?.error).toBe("权限请求已失效，请重新发送或继续当前对话")
  })

  it("routes colliding permission request ids to their own projects", async () => {
    const secondProjectSession: SynapseAgentSessionSummary = {
      ...session,
      projectId: "project-2",
    }
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listPendingPermissions: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
          respondPermission: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listSessions.mockImplementation(async (projectId: string) =>
      projectId === "project-2" ? [secondProjectSession] : [session])
    bridge.listPendingPermissions.mockImplementation(async (projectId: string) => [{
      requestId: "shared-request",
      projectId,
      sessionKey: session.sessionKey,
      conversationId: session.id,
      toolName: "Bash",
      createdAt: "2026-05-13T00:02:00.000Z",
    }])

    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          scope={{ projectIds: ["project-1", "project-2"], defaultProjectId: "project-1" }}
          onChange={(next) => {
            chat = next
          }}
        />,
      )
    })
    await waitFor(() => chat?.pendingPermissions.length === 2)

    await act(async () => {
      await Promise.all([
        chat?.respondPermission({ projectId: "project-1", requestId: "shared-request" }, "allow"),
        chat?.respondPermission({ projectId: "project-2", requestId: "shared-request" }, "deny"),
      ])
    })

    expect(bridge.respondPermission).toHaveBeenCalledWith({
      projectId: "project-1",
      requestId: "shared-request",
      behavior: "allow",
    })
    expect(bridge.respondPermission).toHaveBeenCalledWith({
      projectId: "project-2",
      requestId: "shared-request",
      behavior: "deny",
    })
  })

  it("refreshes pending permissions when selecting a session", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          listPendingPermissions: ReturnType<typeof vi.fn>
          listSessions: ReturnType<typeof vi.fn>
          switchSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.listSessions.mockResolvedValue([session, nextSession])
    bridge.listPendingPermissions
      .mockResolvedValueOnce([{
        requestId: "stale-permission",
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        toolName: "ExitPlanMode",
        createdAt: "2026-05-13T00:02:00.000Z",
      }])
      .mockResolvedValueOnce([])
    bridge.switchSession.mockResolvedValue({ ...nextSession, active: true })

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
    await waitFor(() => chat?.pendingPermissions.length === 1)

    await act(async () => {
      await chat?.selectSession(nextSession)
    })

    expect(bridge.listPendingPermissions).toHaveBeenCalledTimes(2)
    expect(chat?.selectedConversationId).toBe(nextSession.id)
    expect(chat?.pendingPermissions).toEqual([])
  })

  it("updates selected session mode after a permission mode switch", async () => {
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
      await chat?.setPermissionMode("plan")
    })

    expect(chat?.sessions.find((item) => item.id === session.id)?.mode).toBe("plan")
    expect((window as unknown as {
      synapse: {
        agent: {
          setPermissionMode: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.setPermissionMode).toHaveBeenCalledWith({
      projectId: session.projectId,
      conversationId: session.id,
      mode: "plan",
    })
  })

  it("sets permission mode for an explicit target", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          setPermissionMode: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
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

  it("keeps permission mode switch failures handled in hook state", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          setPermissionMode: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.setPermissionMode.mockRejectedValue(new Error("mode switch failed"))
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
      await expect(chat?.setPermissionMode("plan")).resolves.toBeUndefined()
    })

    expect(chat?.error).toBe("mode switch failed")
  })

  it("creates an Agent session with an explicit permission mode", async () => {
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
      await chat?.createSession("project-1", "provider-1", "bypassPermissions")
    })

    expect((window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
    }))
  })

  it("creates an Agent session with provider mode and model tier", async () => {
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
      await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus")
    })

    expect((window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
      modelTier: "opus",
    }))
  })

  it("creates an Agent session with an explicit name", async () => {
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
      await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus", "需求复盘")
    })

    expect((window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
      modelTier: "opus",
      name: "需求复盘",
    }))
  })

  it("keeps the existing fallback name when no explicit name is supplied", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 24, 13, 30))
    try {
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
        await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus")
      })

      expect((window as unknown as {
        synapse: {
          agent: {
            createSession: ReturnType<typeof vi.fn>
          }
        }
      }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
        name: expect.stringMatching(/^新会话 /),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it("logs session create failures without exposing backend error text", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.createSession.mockRejectedValue(new Error("create failed token=sk-secret /Users/liyang/project"))
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
      await chat?.createSession("project-1", "provider-1", "bypassPermissions")
    })

    expect(chat?.error).toBe("创建失败")
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent session create failed.", {
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
      boundary: "renderer.agent.session-create",
      errorName: "Error",
      errorLength: "create failed token=sk-secret /Users/liyang/project".length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/liyang")
  })

  it("shows recoverable knowledge base storage errors when session creation fails", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.createSession.mockRejectedValue(new Error("知识库运行目录不存在。请重新创建知识库或从备份恢复。"))
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
      await chat?.createSession("project-1", "provider-1", "bypassPermissions")
    })

    expect(chat?.error).toBe("知识库运行目录不存在。请重新创建知识库或从备份恢复。")
  })

  it("logs session mutation failures with sanitized target context", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          deleteSession: ReturnType<typeof vi.fn>
          renameSession: ReturnType<typeof vi.fn>
          switchSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.renameSession = vi.fn(async () => undefined)
    bridge.switchSession.mockRejectedValue(new Error("switch failed token=sk-switch"))
    bridge.deleteSession.mockRejectedValue(new Error("delete failed token=sk-delete"))
    bridge.renameSession.mockRejectedValue(new Error("rename failed token=sk-rename"))

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
      await chat?.selectSession(nextSession)
    })
    expect(chat?.error).toBe("切换失败")

    await act(async () => {
      await chat?.deleteSession(session)
    })
    expect(chat?.error).toBe("删除失败")

    await act(async () => {
      await chat?.renameSession(session, "Renamed")
    })
    expect(chat?.error).toBe("重命名失败")

    expect(rendererLogger.error).toHaveBeenCalledWith("Agent session switch failed.", {
      projectId: nextSession.projectId,
      conversationId: nextSession.id,
      sessionKey: nextSession.sessionKey,
      boundary: "renderer.agent.session-switch",
      errorName: "Error",
      errorLength: "switch failed token=sk-switch".length,
    })
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent session delete failed.", {
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
      boundary: "renderer.agent.session-delete",
      errorName: "Error",
      errorLength: "delete failed token=sk-delete".length,
    })
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent session rename failed.", {
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
      boundary: "renderer.agent.session-rename",
      errorName: "Error",
      errorLength: "rename failed token=sk-rename".length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-switch")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-delete")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-rename")
  })

  it("logs cancel and force-kill failures with sanitized conversation context", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          cancelTurn: ReturnType<typeof vi.fn>
          forceKillTurn: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.cancelTurn.mockRejectedValue(new Error("cancel failed with prompt=secret"))
    bridge.forceKillTurn.mockRejectedValue("force kill token=sk-test")

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
      await chat?.cancelTurn()
    })
    expect(chat?.error).toBe("停止失败")

    await act(async () => {
      await chat?.forceKillTurn()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("Agent cancel turn failed.", expect.objectContaining({
      projectId: session.projectId,
      conversationId: session.id,
      boundary: "renderer.agent.cancel-turn",
      errorName: "Error",
      errorLength: "cancel failed with prompt=secret".length,
    }))
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent force kill turn failed.", expect.objectContaining({
      projectId: session.projectId,
      conversationId: session.id,
      boundary: "renderer.agent.force-kill-turn",
      errorName: "string",
      errorLength: "force kill token=sk-test".length,
    }))
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("prompt=secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-test")
  })

  it("cancels and force kills an explicit target", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          cancelTurn: ReturnType<typeof vi.fn>
          forceKillTurn: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
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

  it("resets cancel state when no active turn is found", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          cancelTurn: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent
    bridge.cancelTurn.mockResolvedValue({ status: "no-active-turn" })

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
      await chat?.cancelTurn()
    })

    expect(bridge.cancelTurn).toHaveBeenCalledWith({
      projectId: session.projectId,
      conversationId: session.id,
    })
    expect(chat?.cancelPhase).toBe("idle")
  })
})

function HookProbe({
  onChange,
  scope = projectScope,
}: {
  readonly onChange: (chat: ReturnType<typeof useAgentChat>) => void
  readonly scope?: AgentProjectScope
}): ReactNode {
  const chat = useAgentChat(scope)
  useEffect(() => {
    onChange(chat)
  }, [chat, onChange])
  return null
}

function cachedPersona() {
  return {
    id: "persona-cache",
    schemaVersion: 1,
    name: "缓存智能体",
    description: "来自离线缓存。",
    systemPrompt: "你是缓存智能体。",
    providerModel: null,
    toolPolicy: { mode: "disabled" },
    source: "user",
    readonly: false,
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }
}

function timelineHistoryMessage(index: number) {
  return {
    id: `${session.id}:history:${String(index)}`,
    kind: "message" as const,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `message ${String(index)}`,
    timestamp: new Date(Date.UTC(2026, 7, 3, 0, 0, 0, index)).toISOString(),
  }
}

function timelineResult(entries: SynapseAgentTimelineItem[]): SynapseAgentTimelineResult {
  return {
    projectId: session.projectId,
    sessionKey: session.sessionKey,
    conversationId: session.id,
    entries,
    total: entries.length,
    startIndex: 0,
    hasMore: false,
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error("Timed out waiting for hook update")
}
