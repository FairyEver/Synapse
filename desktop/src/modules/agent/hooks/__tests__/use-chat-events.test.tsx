/**
 * @vitest-environment jsdom
 */
import { useMemo, useRef } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDomainEvent } from "@/types/agent"
import { initialChatState } from "../use-chat-reducer"
import type { ChatAction, ChatState } from "../use-chat-reducer"
import { useChatEvents } from "../use-chat-events"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const bridgeState = vi.hoisted(() => {
  const state: {
    listener?: (event: unknown) => void
    onEvent: ReturnType<typeof vi.fn>
  } = {
    listener: undefined,
    onEvent: vi.fn(),
  }
  state.onEvent.mockImplementation((listener: (event: unknown) => void) => {
    state.listener = listener
    return () => {}
  })
  return state
})

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    agent: {
      onEvent: bridgeState.onEvent,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.debug.mockClear()
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  bridgeState.listener = undefined
  bridgeState.onEvent.mockClear()
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

describe("useChatEvents", () => {
  it("logs live timeline refresh failures with conversation context", async () => {
    const loadTimeline = vi.fn(async () => {
      throw new Error("secret IPC failure detail")
    })
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          loadTimeline={loadTimeline}
        />,
      )
    })

    const event: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "conversationUpdated",
      timestamp: "2026-05-14T00:00:00.000Z",
      payload: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        platform: "renderer",
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(loadTimeline).toHaveBeenCalledWith(event.payload)
    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Agent live timeline refresh failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        boundary: "renderer.agent.live-timeline",
        errorName: "Error",
        errorLength: "secret IPC failure detail".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret IPC failure detail")
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_ERROR", error: "加载会话失败" })
    expect(JSON.stringify((dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls))
      .not.toContain("secret IPC failure detail")
  })

  it("logs pending permission refresh failures after stream events", async () => {
    const refreshPendingPermissions = vi.fn(async () => {
      throw new Error("secret permission refresh detail")
    })
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          refreshPendingPermissions={refreshPendingPermissions}
        />,
      )
    })

    const event: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "permissionRequest",
      timestamp: "2026-05-14T00:00:00.000Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "permissionRequest",
          requestId: "req-1",
          toolName: "test_tool",
          toolInput: "{}",
          toolInputRaw: "{}",
        },
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(refreshPendingPermissions).toHaveBeenCalled()
    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Agent pending permissions refresh failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        eventType: "permissionRequest",
        boundary: "renderer.agent.pending-permissions",
        errorName: "Error",
        errorLength: "secret permission refresh detail".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret permission refresh detail")
  })

  it("applies stream events matched by SDK envelope conversation id", async () => {
    const refreshPendingPermissions = vi.fn(async () => {})
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          refreshPendingPermissions={refreshPendingPermissions}
        />,
      )
    })

    const event = {
      domain: "agent",
      type: "permissionRequest",
      timestamp: "2026-05-14T00:00:00.000Z",
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "permissionRequest",
          requestId: "req-2",
          toolName: "test_tool",
          toolInput: "{}",
          toolInputRaw: "{}",
          conversationId: "conversation-1",
          sdkSessionId: "sdk-session-1",
        },
      },
    } as unknown as SynapseAgentDomainEvent

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(refreshPendingPermissions).toHaveBeenCalled()
    expect(rendererLogger.debug).toHaveBeenCalledWith(
      "Agent stream event applied.",
      expect.objectContaining({
        projectId: "project-1",
        eventType: "permissionRequest",
        conversationId: "conversation-1",
        agentEventType: "permissionRequest",
        sdkSessionId: "sdk-session-1",
        selectedConversationId: "conversation-1",
      }),
    )
  })
})

function HookProbe({
  dispatch,
  loadTimeline,
  refreshPendingPermissions,
}: {
  readonly dispatch: React.Dispatch<ChatAction>
  readonly loadTimeline?: (target: {
    readonly projectId: string
    readonly sessionKey: string
    readonly conversationId?: string
  }) => Promise<void>
  readonly refreshPendingPermissions?: () => Promise<void>
}): ReactNode {
  const projectIdsRef = useRef(["project-1"])
  const defaultProjectIdRef = useRef<string | undefined>("project-1")
  const selectedProjectIdRef = useRef<string | undefined>("project-1")
  const selectedConversationIdRef = useRef<string | undefined>("conversation-1")
  const selectedSessionKeyRef = useRef("local:renderer")
  const selectRequestIdRef = useRef(0)
  const timelineVersionRef = useRef(0)
  const pendingConversationIdsRef = useRef(new Set<string>())
  const followFeishuRef = useRef(false)
  const inputDirtyRef = useRef(false)
  const state = useMemo<ChatState>(() => ({
    ...initialChatState,
    selectedProjectId: "project-1",
    selectedConversationId: "conversation-1",
    selectedSessionKey: "local:renderer",
  }), [])
  const connection = useMemo(() => ({
    loadTimeline: loadTimeline ?? vi.fn(async () => {}),
    refreshConversationSnapshot: vi.fn(async () => {}),
    refreshPendingPermissions: refreshPendingPermissions ?? vi.fn(async () => {}),
    updateTimeline: vi.fn(),
  }), [loadTimeline, refreshPendingPermissions])

  useChatEvents(state, dispatch, {
    projectIdsRef,
    defaultProjectIdRef,
    selectedProjectIdRef,
    selectedConversationIdRef,
    selectedSessionKeyRef,
    selectRequestIdRef,
    timelineVersionRef,
    pendingConversationIdsRef,
    followFeishuRef,
    inputDirtyRef,
  }, connection, "project-1")

  return null
}
