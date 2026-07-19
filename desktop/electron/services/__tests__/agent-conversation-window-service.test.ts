import { describe, expect, it, vi } from "vitest"

import {
  AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL,
  createAgentConversationWindowService,
} from "../agent-conversation-window-service"

describe("agent conversation window service", () => {
  it("opens one window per conversation and focuses duplicates", async () => {
    const broadcasts: unknown[] = []
    const window = createFakeWindow()
    const createWindow = vi.fn((_options: Electron.BrowserWindowConstructorOptions) => window as never)
    const attachWindow = vi.fn()
    const service = createAgentConversationWindowService({
      createWindow,
      attachWindow,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: (_channel, payload) => {
        broadcasts.push(payload)
        return 1
      },
      logger: createLoggerMock(),
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
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      width: 700,
      height: 820,
      minWidth: 400,
      minHeight: 300,
    }))
    expect(createWindow.mock.calls[0]?.[0]).not.toHaveProperty("maxWidth")
    expect(createWindow.mock.calls[0]?.[0]).not.toHaveProperty("maxHeight")
    expect(attachWindow).toHaveBeenCalledWith(
      "agent-conversation:project-1:conversation-1",
      window,
    )
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith(
      "http://localhost:5173?synapseWindow=agent-conversation&projectId=project-1&conversationId=conversation-1&sessionKey=local%3Arenderer&title=%E6%96%B0%E4%BC%9A%E8%AF%9D",
    )
    expect(service.listDetachedConversations()).toEqual([{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: window.id,
      openedAt: "2026-06-17T00:00:00.000Z",
    }])
    expect(broadcasts.length).toBeGreaterThan(0)
  })

  it("removes detached state when the window closes", async () => {
    const window = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: createLoggerMock(),
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })
    window.emitClosed()

    expect(service.listDetachedConversations()).toEqual([])
  })

  it("focuses an existing detached window", async () => {
    const window = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: createLoggerMock(),
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
    expect(window.focus).toHaveBeenCalled()
    expect(AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL).toBe("synapse:agent:detached-conversations-changed")
  })

  it("updates a detached window title and broadcasts its new metadata", async () => {
    const broadcasts: unknown[] = []
    const window = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: (_channel, payload) => {
        broadcasts.push(payload)
        return 1
      },
      logger: createLoggerMock(),
    })
    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "旧标题",
    })

    expect(service.renameConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
    }, "新标题")).toBe(true)

    expect(window.setTitle).toHaveBeenCalledWith("新标题")
    expect(service.listDetachedConversations()).toEqual([expect.objectContaining({
      projectId: "project-1",
      conversationId: "conversation-1",
      title: "新标题",
    })])
    expect(broadcasts.at(-1)).toEqual(service.listDetachedConversations())
  })

  it("closes and detaches a conversation window by conversation target", async () => {
    const broadcasts: unknown[] = []
    const window = createFakeWindow()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: (_channel, payload) => {
        broadcasts.push(payload)
        return 1
      },
      logger: createLoggerMock(),
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })

    expect(service.closeConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
    })).toEqual({ closed: true })

    expect(window.close).toHaveBeenCalledTimes(1)
    expect(service.listDetachedConversations()).toEqual([])
    expect(broadcasts.at(-1)).toEqual([])
  })

  it("removes stale detached state when the tracked window is already destroyed", async () => {
    const window = createFakeWindow()
    window.isDestroyed.mockReturnValue(true)
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: createLoggerMock(),
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })

    expect(service.closeConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
    })).toEqual({ closed: false })

    expect(window.close).not.toHaveBeenCalled()
    expect(service.listDetachedConversations()).toEqual([])
  })

  it("replaces an existing detached window target in place", async () => {
    const broadcasts: unknown[] = []
    const window = createFakeWindow()
    const attachWindow = vi.fn()
    const detachWindow = vi.fn()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      attachWindow,
      detachWindow,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: (_channel, payload) => {
        broadcasts.push(payload)
        return 1
      },
      logger: createLoggerMock(),
    })

    await service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "旧会话",
    })

    await expect(service.replaceConversationWindowTarget({
      from: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话",
      },
    })).resolves.toEqual({ replaced: true })

    expect(service.focusConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })).toEqual({ focused: false })
    expect(service.focusConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-2",
      sessionKey: "local:renderer",
    })).toEqual({ focused: true })
    expect(window.setTitle).toHaveBeenCalledWith("新会话")
    expect(detachWindow).toHaveBeenCalledWith("agent-conversation:project-1:conversation-1")
    expect(attachWindow).toHaveBeenCalledWith("agent-conversation:project-1:conversation-2", window)
    expect(service.listDetachedConversations()).toEqual([{
      projectId: "project-1",
      conversationId: "conversation-2",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: window.id,
      openedAt: "2026-06-17T00:00:00.000Z",
    }])
    expect(broadcasts.at(-1)).toEqual(service.listDetachedConversations())
    window.emitClosed()
    expect(service.listDetachedConversations()).toEqual([])
  })

  it("does not replace a missing detached window target", async () => {
    const service = createAgentConversationWindowService({
      createWindow: () => createFakeWindow() as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger: createLoggerMock(),
    })

    await expect(service.replaceConversationWindowTarget({
      from: {
        projectId: "project-1",
        conversationId: "missing",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话",
      },
    })).resolves.toEqual({ replaced: false })

    expect(service.listDetachedConversations()).toEqual([])
  })

  it("cleans up detached state when loading fails", async () => {
    const window = createFakeWindow()
    const loadError = new Error("load failed")
    window.loadURL.mockRejectedValueOnce(loadError)
    const logger = createLoggerMock()
    const service = createAgentConversationWindowService({
      createWindow: () => window as never,
      baseUrl: () => "http://localhost:5173",
      getPreloadPath: () => "/preload.js",
      getIconPath: () => null,
      now: () => "2026-06-17T00:00:00.000Z",
      broadcast: vi.fn(),
      logger,
    })

    await expect(service.openConversationWindow({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })).rejects.toThrow(loadError)

    expect(service.listDetachedConversations()).toEqual([])
    expect(window.close).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to load agent conversation window.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
      }),
    )
  })
})

function createFakeWindow() {
  const listeners = new Map<string, Array<() => void>>()
  const window = {
    id: Math.floor(Math.random() * 100_000),
    webContents: {
      id: Math.floor(Math.random() * 100_000),
      on: vi.fn(),
      send: vi.fn(),
    },
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(async () => undefined),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "ready-to-show") listener()
    }),
    on: vi.fn((event: string, listener: () => void) => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.concat(listener))
    }),
    restore: vi.fn(),
    setTitle: vi.fn(),
    show: vi.fn(),
    emitClosed: () => {
      for (const listener of listeners.get("closed") ?? []) listener()
    },
  }
  return window
}

function createLoggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}
