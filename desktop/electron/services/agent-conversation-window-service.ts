import { BrowserWindow } from "electron"
import path from "node:path"

import { buildAgentConversationWindowSearchParams } from "../../src/lib/agent-conversation-window"
import type {
  AgentConversationTarget,
  AgentConversationWindowCloseResult,
  AgentConversationWindowFocusResult,
  AgentConversationWindowOpenResult,
  AgentConversationWindowRequest,
  AgentDetachedConversation,
} from "../../src/types/agent-conversation-window"
import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import type { WindowManager } from "../runtime/window"
import { managedBrowserWindow } from "../runtime/window"
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
  readonly attachWindow?: (managerId: string, window: BrowserWindow) => void
  readonly logger: Logger
}

const AGENT_CONVERSATION_WINDOW_BOUNDS = {
  width: 700,
  height: 820,
  minWidth: 400,
  minHeight: 300,
}

function keyForTarget(target: Pick<AgentConversationTarget, "projectId" | "conversationId">): string {
  return `${target.projectId}:${target.conversationId}`
}

function windowManagerIdForKey(key: string): string {
  return `agent-conversation:${key}`
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.focus()
}

function buildWindowUrl(baseUrl: string, request: AgentConversationWindowRequest): string {
  const params = buildAgentConversationWindowSearchParams(request)
  const separator = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}${separator}${params.toString()}`
}

export function createAgentConversationWindowService(deps: Deps) {
  const windowsByKey = new Map<string, BrowserWindow>()
  const detachedByKey = new Map<string, AgentDetachedConversation>()

  function listDetachedConversations(): AgentDetachedConversation[] {
    return [...detachedByKey.values()].sort((left, right) => left.openedAt.localeCompare(right.openedAt))
  }

  function broadcastDetachedConversations(): void {
    deps.broadcast(AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL, listDetachedConversations())
  }

  function removeTrackedWindow(key: string): boolean {
    const hadWindow = windowsByKey.delete(key)
    const hadDetached = detachedByKey.delete(key)
    if (hadWindow || hadDetached) {
      broadcastDetachedConversations()
    }
    return hadWindow || hadDetached
  }

  return {
    async openConversationWindow(
      request: AgentConversationWindowRequest,
    ): Promise<AgentConversationWindowOpenResult> {
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
        ...AGENT_CONVERSATION_WINDOW_BOUNDS,
        show: false,
        title: request.title?.trim() || "对话",
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const managerId = windowManagerIdForKey(key)
      deps.attachWindow?.(managerId, window)
      windowsByKey.set(key, window)
      detachedByKey.set(key, {
        projectId: request.projectId,
        conversationId: request.conversationId,
        sessionKey: request.sessionKey,
        title: request.title?.trim() || "对话",
        windowId: window.id,
        openedAt: deps.now(),
      })
      broadcastDetachedConversations()

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Agent conversation window preload script failed.", { error })
      })

      window.once("ready-to-show", () => {
        window.show()
      })

      window.on("closed", () => {
        removeTrackedWindow(key)
        deps.logger.info("Agent conversation window closed.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
        })
      })

      try {
        await window.loadURL(buildWindowUrl(deps.baseUrl(), request))
      } catch (error) {
        removeTrackedWindow(key)
        deps.logger.error("Failed to load agent conversation window.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          error,
        })
        if (!window.isDestroyed()) window.close()
        throw error
      }

      deps.logger.info("Loaded agent conversation window.", {
        projectId: request.projectId,
        conversationId: request.conversationId,
      })
      return { opened: true }
    },

    focusConversationWindow(target: AgentConversationTarget): AgentConversationWindowFocusResult {
      const window = windowsByKey.get(keyForTarget(target))
      if (!window || window.isDestroyed()) return { focused: false }
      focusWindow(window)
      return { focused: true }
    },

    closeConversationWindow(
      target: Pick<AgentConversationTarget, "projectId" | "conversationId">,
    ): AgentConversationWindowCloseResult {
      const key = keyForTarget(target)
      const window = windowsByKey.get(key)
      if (!window || window.isDestroyed()) {
        removeTrackedWindow(key)
        return { closed: false }
      }

      try {
        window.close()
      } catch (error) {
        deps.logger.warn("Failed to close agent conversation window.", {
          projectId: target.projectId,
          conversationId: target.conversationId,
          error,
        })
        return { closed: false }
      }

      removeTrackedWindow(key)
      deps.logger.info("Closed agent conversation window.", {
        projectId: target.projectId,
        conversationId: target.conversationId,
      })
      return { closed: true }
    },

    listDetachedConversations,
  }
}

export type AgentConversationWindowService = ReturnType<typeof createAgentConversationWindowService>

export function createDefaultAgentConversationWindowService(
  windowManager: WindowManager,
): AgentConversationWindowService {
  return createAgentConversationWindowService({
    createWindow: (options) => new BrowserWindow(options),
    baseUrl: rendererBaseUrl,
    getPreloadPath: () => path.join(__dirname, "../preload.js"),
    getIconPath: () => getWindowIconPath() ?? null,
    now: () => new Date().toISOString(),
    broadcast: (channel, payload) => windowManager.broadcast(channel, payload),
    attachWindow: (managerId, window) => {
      windowManager.attach(
        { id: managerId, role: "detail" },
        managedBrowserWindow(window, "detail"),
      )
    },
    logger: createMainLogger("agent-conversation-window"),
  })
}
