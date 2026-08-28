/**
 * @vitest-environment jsdom
 */
import { useMemo, useRef } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SynapseAgentDomainEvent,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
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
  vi.useRealTimers()
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
        sessionKey: "workflow:private-timeline",
        platform: "renderer",
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(loadTimeline).toHaveBeenCalledWith(event.payload, "refresh-tail")
    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Agent live timeline refresh failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "[redacted]",
        platform: "renderer",
        boundary: "renderer.agent.live-timeline",
        errorName: "Error",
        errorLength: "secret IPC failure detail".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret IPC failure detail")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("workflow:private-timeline")
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_ERROR", error: "加载会话失败" })
    expect(JSON.stringify((dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls))
      .not.toContain("secret IPC failure detail")
  })

  it("does not refresh the full session snapshot for inactive workflow conversations", async () => {
    const loadTimeline = vi.fn(async () => {})
    const refreshConversationSnapshot = vi.fn(async () => {})
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          loadTimeline={loadTimeline}
          refreshConversationSnapshot={refreshConversationSnapshot}
        />,
      )
    })

    const event: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "conversationUpdated",
      timestamp: "2026-05-14T00:00:00.000Z",
      payload: {
        projectId: "project-1",
        conversationId: "workflow-conversation-1",
        sessionKey: "workflow:run-1",
        platform: "workflow",
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(refreshConversationSnapshot).not.toHaveBeenCalled()
    expect(loadTimeline).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_UNREAD",
      updater: expect.any(Function),
    })
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("workflow:run-1")
    expect(rendererLogger.info).toHaveBeenCalledWith(
      "Agent conversation update event received.",
      expect.objectContaining({ sessionKey: "[redacted]", selectedSessionKey: "[redacted]" }),
    )
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
        sessionKey: "scheduled:private-permission",
        platform: "renderer",
        event: {
          type: "permissionRequest",
          requestId: "req-1",
          toolName: "test_tool",
          toolInput: "{}",
          toolInputRaw: {},
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
        sessionKey: "[redacted]",
        platform: "renderer",
        eventType: "permissionRequest",
        boundary: "renderer.agent.pending-permissions",
        errorName: "Error",
        errorLength: "secret permission refresh detail".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret permission refresh detail")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("scheduled:private-permission")
  })

  it("keeps colliding permission request ids from different projects", async () => {
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} />)
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
          requestId: "shared-request",
          toolName: "Bash",
        },
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    const updateAction = (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([action]) => action as ChatAction)
      .find((action) => action.type === "UPDATE_PENDING_PERMISSIONS")
    expect(updateAction?.type).toBe("UPDATE_PENDING_PERMISSIONS")
    if (updateAction?.type !== "UPDATE_PENDING_PERMISSIONS") return
    const otherProjectPermission: SynapseAgentPendingPermission = {
      requestId: "shared-request",
      projectId: "project-2",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      toolName: "Bash",
      createdAt: "2026-05-14T00:00:00.000Z",
    }
    expect(updateAction.updater([otherProjectPermission])).toEqual([
      otherProjectPermission,
      expect.objectContaining({
        projectId: "project-1",
        requestId: "shared-request",
      }),
    ])
  })

  it("refreshes pending permissions after tool result events", async () => {
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

    const event: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "stream",
      timestamp: "2026-05-14T00:00:01.000Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "toolResult",
          toolName: "ExitPlanMode",
          content: "Permission request timed out waiting for user response.",
          status: "error",
          success: false,
        },
      },
    }

    await act(async () => {
      bridgeState.listener?.(event)
      await Promise.resolve()
    })

    expect(refreshPendingPermissions).toHaveBeenCalled()
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
  })

  it("does not mark a conversation as sending from stale events after terminal phase", async () => {
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} />)
    })

    const terminal: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "phase.update",
      timestamp: "2026-05-14T00:00:10.000Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conversation-1",
        runId: "run-1",
        phase: "completed",
        status: "done",
        startedAt: "2026-05-14T00:00:00.000Z",
        completedAt: "2026-05-14T00:00:10.000Z",
      },
    }
    const staleToolEvent: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "toolUse",
      timestamp: "2026-05-14T00:00:09.000Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "toolUse",
          toolName: "TodoWrite",
          toolInput: "{}",
        },
      },
    }

    await act(async () => {
      bridgeState.listener?.(terminal)
      bridgeState.listener?.(staleToolEvent)
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: "REMOVE_SENDING_CONVERSATION",
      conversationId: "conversation-1",
    })
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "ADD_SENDING_CONVERSATION",
      conversationId: "conversation-1",
    })
  })

  it("does not mark a checkpoint postlude as sending after the result", async () => {
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} />)
    })

    await act(async () => {
      bridgeState.listener?.({
        domain: "agent",
        type: "result",
        timestamp: "2026-08-27T00:00:10.000Z",
        scope: { sessionId: "conversation-1" },
        payload: {
          projectId: "project-1",
          sessionKey: "local:renderer",
          platform: "renderer",
          event: {
            type: "result",
            content: "done",
            done: true,
          },
        },
      } satisfies SynapseAgentDomainEvent)
      bridgeState.listener?.({
        domain: "agent",
        type: "fileCheckpoint",
        timestamp: "2026-08-27T00:00:11.000Z",
        scope: { sessionId: "conversation-1" },
        payload: {
          projectId: "project-1",
          sessionKey: "local:renderer",
          platform: "renderer",
          event: {
            type: "fileCheckpoint",
            checkpointId: "checkpoint-1",
            status: "available",
            insertions: 3,
            deletions: 0,
            files: [],
            fileCount: 0,
            coverageWarning: false,
          },
        },
      } satisfies SynapseAgentDomainEvent)
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: "REMOVE_SENDING_CONVERSATION",
      conversationId: "conversation-1",
    })
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "ADD_SENDING_CONVERSATION",
      conversationId: "conversation-1",
    })
  })

  it("marks a later event as sending after an earlier terminal phase", async () => {
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} />)
    })

    await act(async () => {
      bridgeState.listener?.({
        domain: "agent",
        type: "phase.update",
        timestamp: "2026-05-14T00:00:10.000Z",
        scope: { sessionId: "conversation-1" },
        payload: {
          projectId: "project-1",
          sessionKey: "local:renderer",
          conversationId: "conversation-1",
          runId: "run-1",
          phase: "completed",
          status: "done",
          startedAt: "2026-05-14T00:00:00.000Z",
          completedAt: "2026-05-14T00:00:10.000Z",
        },
      })
      bridgeState.listener?.({
        domain: "agent",
        type: "toolUse",
        timestamp: "2026-05-14T00:00:11.000Z",
        scope: { sessionId: "conversation-1" },
        payload: {
          projectId: "project-1",
          sessionKey: "local:renderer",
          platform: "renderer",
          event: {
            type: "toolUse",
            toolName: "TodoWrite",
            toolInput: "{}",
          },
        },
      } satisfies SynapseAgentDomainEvent)
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_SENDING_CONVERSATION",
      conversationId: "conversation-1",
    })
  })

  it("keeps high-frequency thinking token telemetry out of the live timeline", async () => {
    const updateTimeline = vi.fn()
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} updateTimeline={updateTimeline} />)
    })

    const telemetryEvent: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "sdkEvent",
      timestamp: "2026-08-26T01:07:50.486Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "sdkEvent",
          sdkType: "system",
          sdkSubtype: "thinking_tokens",
          payload: { estimated_tokens: 1 },
        },
      },
    }

    await act(async () => {
      for (let index = 0; index < 1_000; index += 1) {
        bridgeState.listener?.(telemetryEvent)
      }
    })

    expect(updateTimeline).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("batches rapid SDK stream deltas before updating the timeline", async () => {
    vi.useFakeTimers()
    const updateTimeline = vi.fn()
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          updateTimeline={updateTimeline}
        />,
      )
    })

    const first: SynapseAgentDomainEvent = {
      domain: "agent",
      type: "stream",
      timestamp: "2026-05-14T00:00:00.000Z",
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "stream",
          deltaType: "text_delta",
          text: "hello",
        },
      },
    }
    const second: SynapseAgentDomainEvent = {
      ...first,
      timestamp: "2026-05-14T00:00:00.001Z",
      payload: {
        ...first.payload,
        event: {
          type: "stream",
          deltaType: "text_delta",
          text: " world",
        },
      },
    }

    await act(async () => {
      bridgeState.listener?.(first)
      bridgeState.listener?.(second)
    })

    expect(updateTimeline).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(50)
    })

    expect(updateTimeline).toHaveBeenCalledTimes(1)
    const updater = updateTimeline.mock.calls[0]?.[0] as ((current: []) => unknown[]) | undefined
    expect(updater?.([])).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        content: "hello world",
      }),
    ])
  })

  it("ignores an older stream delta that arrives after its assistant snapshot", async () => {
    vi.useFakeTimers()
    const updateTimeline = vi.fn()
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe dispatch={dispatch} updateTimeline={updateTimeline} />)
    })

    const base = {
      domain: "agent" as const,
      scope: { sessionId: "conversation-1" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
      },
    }
    await act(async () => {
      bridgeState.listener?.({
        ...base,
        type: "assistant",
        timestamp: "2026-08-11T00:00:02.000Z",
        payload: {
          ...base.payload,
          sequence: 2,
          event: { type: "assistant", content: "Complete answer" },
        },
      } satisfies SynapseAgentDomainEvent)
      bridgeState.listener?.({
        ...base,
        type: "stream",
        timestamp: "2026-08-11T00:00:01.000Z",
        payload: {
          ...base.payload,
          sequence: 1,
          event: { type: "stream", deltaType: "text_delta", text: ":", event: {} },
        },
      } satisfies SynapseAgentDomainEvent)
      vi.advanceTimersByTime(50)
    })

    expect(updateTimeline).toHaveBeenCalledTimes(1)
    const updater = updateTimeline.mock.calls[0]?.[0] as ((current: []) => unknown[]) | undefined
    expect(updater?.([])).toEqual([
      expect.objectContaining({ kind: "message", role: "assistant", content: "Complete answer" }),
    ])
  })

  it("records sequence watermarks before a conversation becomes selected", async () => {
    vi.useFakeTimers()
    const updateTimeline = vi.fn()
    const dispatch: React.Dispatch<ChatAction> = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          selectedConversationId="conversation-1"
          updateTimeline={updateTimeline}
        />,
      )
    })

    const base = {
      domain: "agent" as const,
      scope: { sessionId: "conversation-2" },
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        deliveryEpoch: "delivery-1",
      },
    }
    await act(async () => {
      bridgeState.listener?.({
        ...base,
        type: "assistant",
        timestamp: "2026-08-11T00:00:02.000Z",
        payload: {
          ...base.payload,
          sequence: 2,
          event: { type: "assistant", content: "Complete answer" },
        },
      } satisfies SynapseAgentDomainEvent)
    })
    expect(updateTimeline).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <HookProbe
          dispatch={dispatch}
          selectedConversationId="conversation-2"
          updateTimeline={updateTimeline}
        />,
      )
      bridgeState.listener?.({
        ...base,
        type: "stream",
        timestamp: "2026-08-11T00:00:01.000Z",
        payload: {
          ...base.payload,
          sequence: 1,
          event: { type: "stream", deltaType: "text_delta", text: ":", event: {} },
        },
      } satisfies SynapseAgentDomainEvent)
      vi.advanceTimersByTime(50)
    })

    expect(updateTimeline).not.toHaveBeenCalled()
  })
})

function HookProbe({
  dispatch,
  loadTimeline,
  refreshConversationSnapshot,
  refreshPendingPermissions,
  selectedConversationId = "conversation-1",
  updateTimeline,
}: {
  readonly dispatch: React.Dispatch<ChatAction>
  readonly loadTimeline?: (target: {
    readonly projectId: string
    readonly sessionKey: string
    readonly conversationId?: string
  }) => Promise<void>
  readonly refreshPendingPermissions?: () => Promise<void>
  readonly refreshConversationSnapshot?: (target: {
    readonly projectId: string
    readonly sessionKey: string
    readonly conversationId?: string
  }) => Promise<void>
  readonly selectedConversationId?: string
  readonly updateTimeline?: (updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[]) => void
}): ReactNode {
  const projectIdsRef = useRef(["project-1"])
  const defaultProjectIdRef = useRef<string | undefined>("project-1")
  const selectedProjectIdRef = useRef<string | undefined>("project-1")
  const selectedConversationIdRef = useRef<string | undefined>(selectedConversationId)
  selectedConversationIdRef.current = selectedConversationId
  const selectedSessionKeyRef = useRef("local:renderer")
  const selectRequestIdRef = useRef(0)
  const timelineVersionRef = useRef(0)
  const pendingConversationIdsRef = useRef(new Set<string>())
  const state = useMemo<ChatState>(() => ({
    ...initialChatState,
    selectedProjectId: "project-1",
    selectedConversationId: "conversation-1",
    selectedSessionKey: "local:renderer",
  }), [])
  const connection = useMemo(() => ({
    loadTimeline: loadTimeline ?? vi.fn(async () => {}),
    refreshConversationSnapshot: refreshConversationSnapshot ?? vi.fn(async () => {}),
    refreshPendingPermissions: refreshPendingPermissions ?? vi.fn(async () => {}),
    updateTimeline: updateTimeline ?? vi.fn(),
  }), [loadTimeline, refreshConversationSnapshot, refreshPendingPermissions, updateTimeline])

  useChatEvents(state, dispatch, {
    projectIdsRef,
    defaultProjectIdRef,
    selectedProjectIdRef,
    selectedConversationIdRef,
    selectedSessionKeyRef,
    selectRequestIdRef,
    timelineVersionRef,
    pendingConversationIdsRef,
  }, connection, "project-1")

  return null
}
