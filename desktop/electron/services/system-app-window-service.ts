import { HUB_INSTALLER_VIEW, HUB_INSTALL_REQUEST_PARAM, type HubInstallOpenRequest } from "../../app-capabilities/skill-hub/shared/install-source"
import { app, BrowserWindow } from "electron"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import { IPC_CHANNELS } from "../generated/ipc-channels.generated"
import type { WindowManager } from "../runtime/window"
import { managedBrowserWindow } from "../runtime/window"
import { getSystemAppDefinition } from "../../src/modules/apps/definitions"
import type { MainNavigationInput, MainNavigationRequest } from "../../src/modules/apps/main-navigation"
import type {
  SynapseSystemAppDefinition,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
} from "../../src/modules/apps/types"
import {
  buildDetachedViewWindowUrl,
  createDetachedViewWindowService,
  focusDetachedViewWindow,
} from "./detached-view-window-service"
import { createMainLogger } from "./log-store"

const SYSTEM_APP_CONTENT_OPEN_REQUEST_CHANNEL = "synapse:app:apps:operation:content_open_request"
const SYSTEM_APP_GIT_OPEN_REQUEST_CHANNEL = "synapse:app:apps:operation:git_open_request"
const SYSTEM_APP_TERMINAL_OPEN_REQUEST_CHANNEL = "synapse:app:apps:operation:terminal_open_request"
const SYSTEM_APP_TODO_OPEN_REQUEST_CHANNEL = "synapse:app:apps:operation:todo_open_request"
const SYSTEM_APP_MAIL_OPEN_REQUEST_CHANNEL = "synapse:app:apps:operation:mail_internal_open_request"
export const SYSTEM_APP_WINDOW_SERVICE_ID = "core.system-app-window"

type SystemAppWindowLogger = {
  readonly info: (message: string, metadata?: Record<string, unknown>) => void
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void
  readonly error: (message: string, metadata?: Record<string, unknown>) => void
}

type SystemAppWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getAppDefinition?: (appId: SynapseSystemAppId) => SynapseSystemAppDefinition | null
  readonly windowManager?: WindowManager
  readonly getPreloadPath?: () => string
  readonly logger?: SystemAppWindowLogger
  readonly focusMainWindow?: () => void
  readonly getOwnerId?: () => string | null
  readonly activateApp?: () => void
}

const SYSTEM_APP_WINDOW_BOUNDS = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
}

const SKILL_INSTALLER_WINDOW_BOUNDS = {
  width: 600,
  height: 680,
  minWidth: 420,
  minHeight: 480,
}

const MAIL_COMPOSE_WINDOW_BOUNDS = {
  width: 800,
  height: 640,
  minWidth: 640,
  minHeight: 480,
}

function resolveSystemAppWindowPreloadPath(baseDir: string): string {
  return path.join(baseDir, "../preload.js")
}

function systemAppWindowManagerId(appId: string): string {
  return `system-app:${appId}`
}

function buildSystemAppWindowTitle(definition: SynapseSystemAppDefinition): string {
  return `Synapse AI Studio ${definition.windowTitle}`
}

function sendToSystemAppWindow(
  windowManager: WindowManager | undefined,
  target: BrowserWindow,
  channel: string,
  payload: unknown,
): number {
  return windowManager?.broadcast(
    channel,
    payload,
    (window) => window.id === target.webContents.id,
  ) ?? 0
}

export function createSystemAppWindowService(deps: SystemAppWindowServiceDeps) {
  const logger = deps.logger ?? createMainLogger("system-app.window")
  const detachedWindows = createDetachedViewWindowService({
    createWindow: deps.createWindow,
    logger,
  })

  const composeWindows = new Map<number, { key: string; scope: string; draftKey?: string }>()
  const composeAliases = new Map<string, string>()
  let installerOpening: Promise<unknown> | undefined
  let pendingMainNavigation: MainNavigationRequest | null = null
  let nextNavigationId = 0
  const focusMainWindow = () => {
    deps.activateApp?.()
    if (deps.focusMainWindow) deps.focusMainWindow()
    else deps.windowManager?.open("main")
  }
  const focusInstaller = (window: BrowserWindow) => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    deps.activateApp?.()
    window.focus()
  }
  const deliverMainNavigation = (request: MainNavigationRequest) => {
    focusMainWindow()
    pendingMainNavigation = request
    deps.windowManager?.broadcast(IPC_CHANNELS.apps.mainNavigationRequested, request, (window) => window.role === "main")
  }

  return {
    focusMainWindow,
    navigateMain(destination: MainNavigationInput): void {
      const request = { id: ++nextNavigationId, destination, ownerId: deps.getOwnerId?.() ?? null }
      deliverMainNavigation(request)
    },
    async navigateMainAfter(resolve: () => Promise<MainNavigationInput | null>): Promise<void> {
      const id = ++nextNavigationId
      pendingMainNavigation = null
      const ownerId = deps.getOwnerId?.() ?? null
      const destination = await resolve()
      if (destination && id === nextNavigationId && ownerId === (deps.getOwnerId?.() ?? null)) {
        deliverMainNavigation({ id, ownerId, destination })
      }
    },
    isMainNavigationSender(id: number): boolean {
      return deps.windowManager?.list().some((window) => window.role === "main" && window.webContentsId === id) ?? false
    },
    getPendingMainNavigation(): MainNavigationRequest | null {
      if (pendingMainNavigation?.ownerId && pendingMainNavigation.ownerId !== deps.getOwnerId?.()) {
        pendingMainNavigation = null
      }
      return pendingMainNavigation
    },
    invalidateAccountNavigation(): void {
      if (pendingMainNavigation?.ownerId) pendingMainNavigation = null
      nextNavigationId += 1
    },
    acknowledgeMainNavigation(id: number): void {
      if (pendingMainNavigation?.id === id) pendingMainNavigation = null
    },
    isSkillInstallerSender(id: number) { return detachedWindows.get(HUB_INSTALLER_VIEW)?.webContents.id === id },
    async openSkillInstaller(request: HubInstallOpenRequest) {
      const existing = detachedWindows.get(HUB_INSTALLER_VIEW)
      if (existing) {
        await installerOpening
        if (existing.isDestroyed()) return
        focusInstaller(existing)
        sendToSystemAppWindow(deps.windowManager, existing, "synapse:app:apps:operation:skill_hub_install_open_request", request)
        return
      }
      const windowId = systemAppWindowManagerId(HUB_INSTALLER_VIEW)
      const params = new URLSearchParams({ window: "system-app", appId: HUB_INSTALLER_VIEW,
        [HUB_INSTALL_REQUEST_PARAM]: JSON.stringify(request) })
      installerOpening = detachedWindows.open({
        key: HUB_INSTALLER_VIEW,
        payload: buildDetachedViewWindowUrl(deps.baseUrl(), params),
        options: {
          ...SKILL_INSTALLER_WINDOW_BOUNDS,
          title: "Skill 安装",
          show: false,
          webPreferences: {
            preload: deps.getPreloadPath?.() ?? resolveSystemAppWindowPreloadPath(__dirname),
            contextIsolation: true, nodeIntegration: false, sandbox: true,
          },
        },
        load: (window, url) => window.loadURL(url),
        onReadyToShow: focusInstaller,
        onCreated: ({ window }) => deps.windowManager?.attach({ id: windowId, role: "detail" }, managedBrowserWindow(window, "detail")),
        onRemoved: () => deps.windowManager?.detach(windowId),
      })
      try { await installerOpening } finally { installerOpening = undefined }
    },
    bindMailComposeDraft(senderId: number, draftId: string): void {
      const entry = composeWindows.get(senderId)
      if (!entry || !detachedWindows.get(entry.key)) return
      if (entry.draftKey) composeAliases.delete(entry.draftKey)
      entry.draftKey = `${entry.scope}:draft:${draftId}`
      composeAliases.set(entry.draftKey, entry.key)
    },
    async open(appId: SynapseSystemAppId, options: SynapseSystemAppOpenOptions = {}): Promise<void> {
      const definition = (deps.getAppDefinition ?? getSystemAppDefinition)(appId)
      if (!definition) {
        logger.warn("Rejected unknown system app window request.", { appId })
        throw new Error("Unknown system app.")
      }
      if (!definition.window.openable) {
        logger.warn("Rejected non-openable system app window request.", {
          appId,
          appType: definition.type,
        })
        throw new Error("System app does not support detached windows.")
      }

      const request = options.mailOpenRequest
      const compose = appId === "mail" ? request?.compose : undefined
      const composeTarget = compose ? ("draftId" in compose ? `draft:${compose.draftId}` : compose.sourceMessageId ? `${compose.accountId}:${compose.mode}:${compose.sourceMessageId}` : `new:${compose.accountId}${"recipient" in compose && compose.recipient ? `:recipient:${compose.recipient.address}` : ""}`) : null
      const lookupKey = composeTarget ? `${appId}:compose:${request!.ownerId}:${request!.generation}:${composeTarget}` : appId
      const existing = detachedWindows.get(composeAliases.get(lookupKey) ?? lookupKey)
      if (existing) {
        focusDetachedViewWindow(existing)
        if (compose) return
        if (options.contentOpenRequest) {
          const sent = sendToSystemAppWindow(
            deps.windowManager,
            existing,
            SYSTEM_APP_CONTENT_OPEN_REQUEST_CHANNEL,
            options.contentOpenRequest,
          )
          if (sent === 0) {
            logger.warn("Skipped content open request for unmanaged system app window.", {
              appId,
              appType: definition.type,
            })
          }
        }
        if (options.gitOpenRequest) {
          const sent = sendToSystemAppWindow(
            deps.windowManager,
            existing,
            SYSTEM_APP_GIT_OPEN_REQUEST_CHANNEL,
            options.gitOpenRequest,
          )
          if (sent === 0) {
            logger.warn("Skipped Git open request for unmanaged system app window.", {
              appId,
              appType: definition.type,
            })
          }
        }
        if (options.terminalOpenRequest) {
          const sent = sendToSystemAppWindow(
            deps.windowManager,
            existing,
            SYSTEM_APP_TERMINAL_OPEN_REQUEST_CHANNEL,
            options.terminalOpenRequest,
          )
          if (sent === 0) {
            logger.warn("Skipped Terminal open request for unmanaged system app window.", {
              appId,
              appType: definition.type,
            })
          }
        }
        if(options.viewOpenRequest)sendToSystemAppWindow(deps.windowManager,existing,"synapse:app:apps:operation:view_open_request",options.viewOpenRequest)
        if (options.todoOpenRequest) {
          sendToSystemAppWindow(deps.windowManager, existing, SYSTEM_APP_TODO_OPEN_REQUEST_CHANNEL, options.todoOpenRequest)
        }
        if (options.mailOpenRequest) {
          sendToSystemAppWindow(deps.windowManager, existing, "synapse:app:apps:operation:mail_open_request", options.mailOpenRequest)
        }
        if (options.mailInternalOpenRequest) {
          sendToSystemAppWindow(deps.windowManager, existing, SYSTEM_APP_MAIL_OPEN_REQUEST_CHANNEL, options.mailInternalOpenRequest)
        }
        logger.info("Focused existing system app window.", { appId, appType: definition.type })
        return
      }

      const windowKey = compose ? `mail:compose-window:${randomUUID()}` : appId
      const baseUrl = deps.baseUrl()
      const params = new URLSearchParams({ window: "system-app", appId })
      if (compose) params.set("mailCompose", "1")
      if (options.contentOpenRequest) {
        params.set("contentOpenRequest", JSON.stringify(options.contentOpenRequest))
      }
      if (options.gitOpenRequest) {
        params.set("gitOpenRequest", JSON.stringify(options.gitOpenRequest))
      }
      if (options.terminalOpenRequest) {
        params.set("terminalOpenRequest", JSON.stringify(options.terminalOpenRequest))
      }
      if(options.viewOpenRequest)params.set("viewOpenRequest",JSON.stringify(options.viewOpenRequest))
      if (options.todoOpenRequest) {
        params.set("todoOpenRequest", JSON.stringify(options.todoOpenRequest))
      }
      if (options.mailOpenRequest) params.set("mailOpenRequest", JSON.stringify(options.mailOpenRequest))
      if (options.mailInternalOpenRequest) {
        params.set("mailInternalOpenRequest", JSON.stringify(options.mailInternalOpenRequest))
      }
      const url = buildDetachedViewWindowUrl(baseUrl, params)
      await detachedWindows.open({
        key: windowKey,
        payload: { appId, definition, url },
        options: {
          ...(compose ? MAIL_COMPOSE_WINDOW_BOUNDS : SYSTEM_APP_WINDOW_BOUNDS),
          title: compose ? "写邮件" : buildSystemAppWindowTitle(definition),
          webPreferences: {
            preload: deps.getPreloadPath?.() ?? resolveSystemAppWindowPreloadPath(__dirname),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
        load: (targetWindow, payload) => targetWindow.loadURL(payload.url),
        onCreated: ({ window }) => {
          if (compose) {
            composeWindows.set(window.webContents.id, { key: windowKey, scope: `mail:compose:${request!.ownerId}:${request!.generation}`, ...("draftId" in compose ? { draftKey: lookupKey } : {}) })
            composeAliases.set(lookupKey, windowKey)
          }
          deps.windowManager?.attach(
            { id: systemAppWindowManagerId(windowKey), role: "detail" },
            managedBrowserWindow(window, "detail"),
          )
        },
        onRemoved: () => {
          for (const [id, entry] of composeWindows) if (entry.key === windowKey) {
            for (const [alias, key] of composeAliases) if (key === windowKey) composeAliases.delete(alias)
            composeWindows.delete(id)
          }
          deps.windowManager?.detach(systemAppWindowManagerId(windowKey))
        },
        onClosed: () => {
          logger.info("System app window closed.", { appId, appType: definition.type })
        },
      })
      logger.info("Loaded system app window.", { appId, appType: definition.type })
    },
  }
}

export function createDefaultSystemAppWindowService(
  windowManager: WindowManager,
  focusMainWindow?: () => void,
  getOwnerId?: () => string | null,
) {
  return createSystemAppWindowService({
    createWindow: (options) => new BrowserWindow(options),
    baseUrl: rendererBaseUrl,
    windowManager,
    focusMainWindow,
    getOwnerId,
    activateApp: () => { if (process.platform === "darwin") app.focus({ steal: true }) },
    getPreloadPath: () => resolveSystemAppWindowPreloadPath(__dirname),
  })
}
