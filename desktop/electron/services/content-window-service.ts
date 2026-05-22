import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../src/constants/defaults"
import {
  buildContentCreateWindowSearchParams,
  buildContentDetailWindowSearchParams,
  buildContentEditWindowSearchParams,
} from "../../src/lib/content-window"
import type {
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentDetailWindowPayload,
  SynapseOpenContentEditWindowPayload,
  SynapseOpenContentWindowPayload,
} from "../../src/types/content"
import { getWindowIconPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"
import { RendererHealthService } from "./renderer-health"

const logger = createMainLogger("content-window")
const contentWindows = new Set<BrowserWindow>()
const contentWindowHealthServices = new WeakMap<BrowserWindow, ContentWindowHealth>()
const CONTENT_DETAIL_WINDOW_BOUNDS = {
  width: 1280,
  height: 760,
  minWidth: 1120,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}
const CONTENT_EDITOR_WINDOW_BOUNDS_BY_TYPE = {
  prompt: { width: 1120, height: 760, minWidth: 960, minHeight: 640 },
  rule: { width: 1120, height: 760, minWidth: 960, minHeight: 640 },
  skill: { width: 1280, height: 820, minWidth: 1120, minHeight: 680 },
} as const

type ContentEditorInitPayload =
  | SynapseOpenContentCreateWindowPayload
  | SynapseOpenContentEditWindowPayload

type AnyContentWindowPayload =
  | SynapseOpenContentDetailWindowPayload
  | SynapseOpenContentCreateWindowPayload
  | SynapseOpenContentEditWindowPayload

type ContentWindowLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type ContentWindowHealth = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type ContentWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (payload: AnyContentWindowPayload) => ContentWindowHealth
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: ContentWindowLogger
  loadWindow?: (window: BrowserWindow, payload: AnyContentWindowPayload) => Promise<void>
}

function isEditWindowPayload(payload: AnyContentWindowPayload): payload is SynapseOpenContentEditWindowPayload {
  return "origin" in payload
}

function isDetailWindowPayload(payload: AnyContentWindowPayload): payload is SynapseOpenContentDetailWindowPayload {
  return "viewMode" in payload
}

function buildSearchParams(payload: AnyContentWindowPayload): URLSearchParams {
  if (isEditWindowPayload(payload)) {
    return buildContentEditWindowSearchParams(payload)
  }

  if (isDetailWindowPayload(payload)) {
    return buildContentDetailWindowSearchParams(payload)
  }

  return buildContentCreateWindowSearchParams(payload)
}

async function loadContentWindow(
  window: BrowserWindow,
  payload: AnyContentWindowPayload,
): Promise<void> {
  const searchParams = buildSearchParams(payload)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    const url = new URL(devServerUrl)

    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }

    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

function createDetailWindowKey(payload: SynapseOpenContentDetailWindowPayload): string {
  return `detail:${payload.contentType}:${payload.id}`
}

function createCreateWindowKey(payload: SynapseOpenContentCreateWindowPayload): string {
  return `create:${payload.contentType}`
}

function createEditWindowKey(payload: SynapseOpenContentEditWindowPayload): string {
  return `edit:${payload.contentType}:${payload.id}`
}

function createWindowLogMetadata(payload: AnyContentWindowPayload): Record<string, string | undefined> {
  return {
    contentId: "id" in payload ? payload.id : undefined,
    contentType: payload.contentType,
  }
}

function createRendererHealthLabel(payload: AnyContentWindowPayload): string {
  if (isEditWindowPayload(payload)) {
    return `${payload.contentType}.edit.${payload.id}`
  }

  if (isDetailWindowPayload(payload)) {
    return `${payload.contentType}.detail.${payload.id}`
  }

  return `${payload.contentType}.create`
}

function createContentWindowService(deps: ContentWindowServiceDeps) {
  const windowsByKey = new Map<string, BrowserWindow>()
  const pendingEditorPayloads = new Map<string, ContentEditorInitPayload>()

  async function openManagedWindow(
    key: string,
    payload: AnyContentWindowPayload,
    bounds: typeof CONTENT_DETAIL_WINDOW_BOUNDS,
  ): Promise<void> {
    const existingWindow = windowsByKey.get(key)

    if (existingWindow && !existingWindow.isDestroyed()) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore()
      }
      existingWindow.focus()
      deps.logger.info("Focused existing content window.", createWindowLogMetadata(payload))
      return
    }

    const { width, height, minWidth, minHeight } = bounds
    const icon = deps.getIconPath()
    const window = deps.createWindow({
      width,
      height,
      minWidth,
      minHeight,
      show: false,
      title: payload.title,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: deps.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    contentWindows.add(window)
    windowsByKey.set(key, window)
    const health = deps.createHealthService(payload)
    health.attach(window.webContents)
    contentWindowHealthServices.set(window, health)

    window.webContents.on("preload-error", (_event, _preloadPath, error) => {
      deps.logger.error("Content window preload script failed.", { error })
    })

    window.once("ready-to-show", () => {
      window.show()
    })

    window.on("closed", () => {
      health.detach()
      contentWindowHealthServices.delete(window)
      contentWindows.delete(window)
      windowsByKey.delete(key)
    })

    await (deps.loadWindow ?? loadContentWindow)(window, payload)
  }

  return {
    async openDetailWindow(payload: SynapseOpenContentWindowPayload): Promise<void> {
      await openManagedWindow(createDetailWindowKey(payload), payload, CONTENT_DETAIL_WINDOW_BOUNDS)
    },

    async openCreateWindow(payload: SynapseOpenContentCreateWindowPayload): Promise<void> {
      if (payload.requestId) {
        pendingEditorPayloads.set(payload.requestId, payload)
      }

      await openManagedWindow(
        createCreateWindowKey(payload),
        payload,
        CONTENT_EDITOR_WINDOW_BOUNDS_BY_TYPE[payload.contentType],
      )
    },

    async openEditWindow(payload: SynapseOpenContentEditWindowPayload): Promise<void> {
      if (payload.requestId) {
        pendingEditorPayloads.set(payload.requestId, payload)
      }

      await openManagedWindow(
        createEditWindowKey(payload),
        payload,
        CONTENT_EDITOR_WINDOW_BOUNDS_BY_TYPE[payload.contentType],
      )
    },

    readPendingEditorPayload(requestId: string): ContentEditorInitPayload | null {
      const payload = pendingEditorPayloads.get(requestId) ?? null
      pendingEditorPayloads.delete(requestId)
      return payload
    },
  }
}

const contentWindowService = createContentWindowService({
  createWindow: (options) => new BrowserWindow(options),
  createHealthService: (payload) => new RendererHealthService({
    logger: createMainLogger(`renderer-health.content.${createRendererHealthLabel(payload)}`),
  }),
  getAppPath: () => app.getAppPath(),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../preload.js"),
  logger,
})

export { contentWindowService, createContentWindowService }
