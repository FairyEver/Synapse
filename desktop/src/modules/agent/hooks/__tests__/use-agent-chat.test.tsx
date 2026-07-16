/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDomainEvent, SynapseAgentSessionSummary } from "@/types/agent"
import { useAgentChat } from "../use-agent-chat"
import { createImageAttachment, createPathAttachment } from "../../attachments"
import type { AgentProjectScope } from "../../project-resolution"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      updateSessionPersona: vi.fn(async () => ({
        ...session,
        activeMainThreadPersonaId: "builtin-zh-en-translator",
        activeMainThreadPersonaName: "中英翻译",
        activeMainThreadPersonaSource: "builtin",
      })),
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

  it("loads persona menu from offline cache result", async () => {
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

  it("updates the active session persona through the bridge", async () => {
    const bridge = (window as unknown as {
      synapse: {
        agent: {
          updateSessionPersona: ReturnType<typeof vi.fn>
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
      await chat?.updateSessionPersona(session, "builtin-zh-en-translator")
    })

    expect(bridge.updateSessionPersona).toHaveBeenCalledWith({
      projectId: session.projectId,
      conversationId: session.id,
      personaId: "builtin-zh-en-translator",
    })
    expect(chat?.sessions[0]?.activeMainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(chat?.personas[0]?.name).toBe("中英翻译")
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

  it("sends attachment-only images with readable optimistic content and binary payload", async () => {
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

    const imageData = new Uint8Array([1, 2, 3]).buffer
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
            bytes: imageData,
          }),
        ],
      }))

    expect(sent).toBe(true)
    expect(chat?.timeline.at(-1)).toMatchObject({
      kind: "message",
      role: "user",
      content: "[Image #1]",
    })
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: session.projectId,
      conversationId: session.id,
      sessionKey: session.sessionKey,
      content: "[Image #1]",
      attachments: [{
        kind: "image",
        mimeType: "image/png",
        name: "screen.png",
        size: 3,
        data: imageData,
      }],
    }))
    expect(JSON.stringify(bridge.send.mock.calls)).not.toContain("base64")
  })

  it("sends path attachments as readable path context and path payload entries", async () => {
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

    const expectedContent = [
      "粘贴文件:",
      "/Users/liyang/Desktop/brief.md",
      "",
      "粘贴文件夹:",
      "/Users/liyang/Downloads/materials",
      "",
      "请分析",
    ].join("\n")
    expect(sent).toBe(true)
    expect(chat?.timeline.at(-1)).toMatchObject({
      kind: "message",
      role: "user",
      content: expectedContent,
    })
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expectedContent,
      attachments: [
        {
          kind: "path",
          path: "/Users/liyang/Desktop/brief.md",
          entryType: "file",
          name: "brief.md",
        },
        {
          kind: "path",
          path: "/Users/liyang/Downloads/materials",
          entryType: "directory",
          name: "materials",
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
        await chat?.respondPermission("permission-1", "allow")
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
        await chat?.respondPermission("permission-1", "allow")
      } catch (error) {
        responseError = error
      }
    })

    expect(responseError).toBeInstanceOf(Error)
    expect(chat?.pendingPermissions).toEqual([])
    expect(chat?.error).toBe("权限请求已失效，请重新发送或继续当前对话")
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

function HookProbe({ onChange }: { readonly onChange: (chat: ReturnType<typeof useAgentChat>) => void }): ReactNode {
  const chat = useAgentChat(projectScope)
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error("Timed out waiting for hook update")
}
