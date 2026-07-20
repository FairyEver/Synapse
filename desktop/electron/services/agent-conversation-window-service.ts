import { BrowserWindow } from "electron"
import path from "node:path"

import { buildAgentConversationWindowSearchParams } from "../../src/lib/agent-conversation-window"
import type {
  AgentConversationTarget,
  AgentConversationWindowCloseResult,
  AgentConversationWindowFocusResult,
  AgentConversationWindowOpenResult,
  AgentConversationWindowReplaceRequest,
  AgentConversationWindowReplaceResult,
  AgentConversationWindowRequest,
  AgentDetachedConversation,
} from "../../src/types/agent-conversation-window"
import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import type { WindowManager } from "../runtime/window"
import { managedBrowserWindow } from "../runtime/window"
import { getWindowIconPath } from "./app-icon-service"
import {
  buildDetachedViewWindowUrl,
  createDetachedViewWindowService,
  focusDetachedViewWindow,
} from "./detached-view-window-service"
import { createMainLogger } from "./log-store"

export const AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL = "synapse:app:agent:operation:detached_conversations_changed"
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
  readonly detachWindow?: (managerId: string) => void
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

function buildWindowUrl(baseUrl: string, request: AgentConversationWindowRequest): string {
  const params = buildAgentConversationWindowSearchParams(request)
  return buildDetachedViewWindowUrl(baseUrl, params)
}

export function createAgentConversationWindowService(deps: Deps) {
  const detachedWindows = createDetachedViewWindowService({
    createWindow: deps.createWindow,
    logger: deps.logger,
  })
  const detachedByKey = new Map<string, AgentDetachedConversation>()

  function listDetachedConversations(): AgentDetachedConversation[] {
    return [...detachedByKey.values()].sort((left, right) => left.openedAt.localeCompare(right.openedAt))
  }

  function broadcastDetachedConversations(): void {
    deps.broadcast(AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL, listDetachedConversations())
  }

  function removeDetachedState(key: string): boolean {
    const hadDetached = detachedByKey.delete(key)
    if (hadDetached) {
      deps.detachWindow?.(windowManagerIdForKey(key))
      broadcastDetachedConversations()
    }
    return hadDetached
  }

  function removeTrackedWindow(key: string): boolean {
    const hadWindow = detachedWindows.remove(key)
    const hadDetached = removeDetachedState(key)
    return hadWindow || hadDetached
  }

  return {
    async openConversationWindow(
      request: AgentConversationWindowRequest,
    ): Promise<AgentConversationWindowOpenResult> {
      const key = keyForTarget(request)
      const existing = detachedWindows.get(key)
      if (existing) {
        focusDetachedViewWindow(existing)
        deps.logger.info("Focused existing agent conversation window.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
        })
        return { opened: true }
      }

      const icon = deps.getIconPath()
      await detachedWindows.open({
        key,
        payload: request,
        options: {
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
        },
        load: (targetWindow, targetRequest) => targetWindow.loadURL(buildWindowUrl(deps.baseUrl(), targetRequest)),
        logMetadata: (targetRequest) => ({
          projectId: targetRequest.projectId,
          conversationId: targetRequest.conversationId,
        }),
        preloadErrorMessage: "Agent conversation window preload script failed.",
        loadErrorMessage: "Failed to load agent conversation window.",
        onCreated: ({ window }) => {
          const managerId = windowManagerIdForKey(key)
          deps.attachWindow?.(managerId, window)
          detachedByKey.set(key, {
            projectId: request.projectId,
            conversationId: request.conversationId,
            sessionKey: request.sessionKey,
            title: request.title?.trim() || "对话",
            windowId: window.id,
            openedAt: deps.now(),
          })
          broadcastDetachedConversations()
        },
        onRemoved: ({ key: removedKey }) => {
          removeDetachedState(removedKey)
        },
        onClosed: () => {
          deps.logger.info("Agent conversation window closed.", {
            projectId: request.projectId,
            conversationId: request.conversationId,
          })
        },
        onReadyToShow: (targetWindow) => targetWindow.show(),
      })

      deps.logger.info("Loaded agent conversation window.", {
        projectId: request.projectId,
        conversationId: request.conversationId,
      })
      return { opened: true }
    },

    focusConversationWindow(target: AgentConversationTarget): AgentConversationWindowFocusResult {
      if (!detachedWindows.focus(keyForTarget(target))) return { focused: false }
      return { focused: true }
    },

    renameConversationWindow(
      target: Pick<AgentConversationTarget, "projectId" | "conversationId">,
      titleValue: string,
    ): boolean {
      const key = keyForTarget(target)
      const window = detachedWindows.get(key)
      const detached = detachedByKey.get(key)
      if (!window || !detached) {
        if (!window && detached) removeTrackedWindow(key)
        return false
      }

      const title = titleValue.trim() || "对话"
      try {
        window.setTitle(title)
      } catch (error) {
        deps.logger.warn("Failed to rename agent conversation window.", {
          projectId: target.projectId,
          conversationId: target.conversationId,
          error,
        })
        return false
      }
      detachedByKey.set(key, { ...detached, title })
      broadcastDetachedConversations()
      return true
    },

    closeConversationWindow(
      target: Pick<AgentConversationTarget, "projectId" | "conversationId">,
    ): AgentConversationWindowCloseResult {
      const key = keyForTarget(target)
      const window = detachedWindows.get(key)
      if (!window) {
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

    async replaceConversationWindowTarget(
      request: AgentConversationWindowReplaceRequest,
    ): Promise<AgentConversationWindowReplaceResult> {
      const oldKey = keyForTarget(request.from)
      const window = detachedWindows.get(oldKey)
      if (!window) {
        return { replaced: false }
      }

      const newKey = keyForTarget(request.to)
      const existingNewWindow = detachedWindows.get(newKey)
      if (existingNewWindow && existingNewWindow !== window) {
        focusDetachedViewWindow(existingNewWindow)
        return { replaced: false }
      }

      const previousDetached = detachedByKey.get(oldKey)
      const title = request.to.title?.trim() || "对话"
      if (oldKey !== newKey) {
        detachedByKey.delete(oldKey)
        deps.detachWindow?.(windowManagerIdForKey(oldKey))
        detachedWindows.replaceKey(oldKey, newKey)
        deps.attachWindow?.(windowManagerIdForKey(newKey), window)
      }

      window.setTitle(title)
      detachedByKey.set(newKey, {
        projectId: request.to.projectId,
        conversationId: request.to.conversationId,
        sessionKey: request.to.sessionKey,
        title,
        windowId: window.id,
        openedAt: previousDetached?.openedAt ?? deps.now(),
      })
      broadcastDetachedConversations()
      deps.logger.info("Replaced agent conversation window target.", {
        fromProjectId: request.from.projectId,
        fromConversationId: request.from.conversationId,
        projectId: request.to.projectId,
        conversationId: request.to.conversationId,
      })
      return { replaced: true }
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
    detachWindow: (managerId) => {
      windowManager.detach(managerId)
    },
    logger: createMainLogger("agent-conversation-window"),
  })
}
