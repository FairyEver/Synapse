import { BrowserWindow } from "electron"
import path from "node:path"

import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import type { WindowManager } from "../runtime/window"
import { managedBrowserWindow } from "../runtime/window"
import { getSystemAppDefinition } from "../../src/modules/apps/definitions"
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
}

const SYSTEM_APP_WINDOW_BOUNDS = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
}

function resolveSystemAppWindowPreloadPath(baseDir: string): string {
  return path.join(baseDir, "../preload.js")
}

function systemAppWindowManagerId(appId: SynapseSystemAppId): string {
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

  return {
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

      const existing = detachedWindows.get(appId)
      if (existing) {
        focusDetachedViewWindow(existing)
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
        logger.info("Focused existing system app window.", { appId, appType: definition.type })
        return
      }

      const baseUrl = deps.baseUrl()
      const params = new URLSearchParams({ window: "system-app", appId })
      if (options.contentOpenRequest) {
        params.set("contentOpenRequest", JSON.stringify(options.contentOpenRequest))
      }
      if (options.gitOpenRequest) {
        params.set("gitOpenRequest", JSON.stringify(options.gitOpenRequest))
      }
      const url = buildDetachedViewWindowUrl(baseUrl, params)
      await detachedWindows.open({
        key: appId,
        payload: { appId, definition, url },
        options: {
          ...SYSTEM_APP_WINDOW_BOUNDS,
          title: buildSystemAppWindowTitle(definition),
          webPreferences: {
            preload: deps.getPreloadPath?.() ?? resolveSystemAppWindowPreloadPath(__dirname),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
        load: (targetWindow, payload) => targetWindow.loadURL(payload.url),
        onCreated: ({ window }) => {
          deps.windowManager?.attach(
            { id: systemAppWindowManagerId(appId), role: "detail" },
            managedBrowserWindow(window, "detail"),
          )
        },
        onRemoved: () => {
          deps.windowManager?.detach(systemAppWindowManagerId(appId))
        },
        onClosed: () => {
          logger.info("System app window closed.", { appId, appType: definition.type })
        },
      })
      logger.info("Loaded system app window.", { appId, appType: definition.type })
    },
  }
}

export function createDefaultSystemAppWindowService(windowManager: WindowManager) {
  return createSystemAppWindowService({
    createWindow: (options) => new BrowserWindow(options),
    baseUrl: rendererBaseUrl,
    windowManager,
    getPreloadPath: () => resolveSystemAppWindowPreloadPath(__dirname),
  })
}
