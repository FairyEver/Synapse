import { app, BrowserWindow } from "electron"
import path from "node:path"

import { buildSkillRepositoryInstallWindowSearchParams } from "../../src/lib/skill-repository-install-window"
import type { SynapseSkillRepositoryInstallWindowRequest } from "../../src/types/skill-repository-install"
import { getWindowIconPath } from "./app-icon-service"
import { createMainLogger } from "./log-store"
import { RendererHealthService } from "./renderer-health"
import { skillRepositoryInstallService } from "./skill-repository-install-service"

const SKILL_REPOSITORY_INSTALL_WINDOW_BOUNDS = {
  width: 1280,
  height: 820,
  minWidth: 1120,
  minHeight: 680,
}

type SkillRepositoryInstallWindowHealth = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type SkillRepositoryInstallWindowLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type SkillRepositoryInstallWindowServiceDeps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (request: SynapseSkillRepositoryInstallWindowRequest) => SkillRepositoryInstallWindowHealth
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: SkillRepositoryInstallWindowLogger
  cleanupSession?: (sessionId: string) => Promise<void>
  loadWindow?: (
    window: BrowserWindow,
    request: SynapseSkillRepositoryInstallWindowRequest,
  ) => Promise<void>
}

async function loadSkillRepositoryInstallWindow(
  window: BrowserWindow,
  request: SynapseSkillRepositoryInstallWindowRequest,
  appPath: string,
): Promise<void> {
  const searchParams = buildSkillRepositoryInstallWindowSearchParams(request)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value)
    }
    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(path.join(appPath, "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

function createSkillRepositoryInstallWindowService(deps: SkillRepositoryInstallWindowServiceDeps) {
  const windowsBySession = new Map<string, BrowserWindow>()

  return {
    async open(request: SynapseSkillRepositoryInstallWindowRequest): Promise<void> {
      const existingWindow = windowsBySession.get(request.session)

      if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        deps.logger.info("Focused existing skill repository install window.")
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...SKILL_REPOSITORY_INSTALL_WINDOW_BOUNDS,
        show: false,
        title: "安装 Skill",
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const health = deps.createHealthService(request)
      health.attach(window.webContents)
      windowsBySession.set(request.session, window)
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        health.detach()
        if (windowsBySession.get(request.session) === window) {
          windowsBySession.delete(request.session)
        }
        void deps.cleanupSession?.(request.session).catch((error) => {
          deps.logger.warn("Failed to clean skill repository install window session.", {
            error,
            sessionIdLength: request.session.length,
          })
        })
      }

      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("Skill repository install window preload script failed.", { error })
      })
      window.once("ready-to-show", () => window.show())
      window.on("closed", cleanup)

      try {
        await (deps.loadWindow ?? ((targetWindow, targetRequest) =>
          loadSkillRepositoryInstallWindow(targetWindow, targetRequest, deps.getAppPath())))(window, request)
      } catch (error) {
        cleanup()
        deps.logger.error("Failed to load skill repository install window.", { error })
        if (!window.isDestroyed()) window.close()
        throw error
      }
    },
  }
}

type SkillRepositoryInstallWindowService = ReturnType<typeof createSkillRepositoryInstallWindowService>

let defaultService: SkillRepositoryInstallWindowService | null = null

function getDefaultService(): SkillRepositoryInstallWindowService {
  defaultService ??= createSkillRepositoryInstallWindowService({
    createWindow: (options) => new BrowserWindow(options),
    createHealthService: () => new RendererHealthService({
      logger: createMainLogger("renderer-health.skill-repository-install"),
    }),
    getAppPath: () => app.getAppPath(),
    getIconPath: () => getWindowIconPath() ?? null,
    getPreloadPath: () => path.join(__dirname, "../preload.js"),
    logger: createMainLogger("skill-repository-install-window"),
    cleanupSession: (sessionId) => skillRepositoryInstallService.cleanupIfIdle(sessionId),
  })
  return defaultService
}

const skillRepositoryInstallWindowService = {
  open(request: SynapseSkillRepositoryInstallWindowRequest): Promise<void> {
    return getDefaultService().open(request)
  },
}

export {
  createSkillRepositoryInstallWindowService,
  loadSkillRepositoryInstallWindow,
  skillRepositoryInstallWindowService,
}
export type { SkillRepositoryInstallWindowService }
