import type { CustomAppDto, CustomAppId } from "@synapse/shared/custom-apps-contracts"
import type { BrowserWindow } from "electron"

import { managedBrowserWindow, type WindowManager } from "../../runtime/window"
import type { CustomWebAppRuntimeService } from "./runtime-service"
import { isAllowedCustomWebUrl } from "./web-session"

export const CUSTOM_WEB_APP_WINDOW_SERVICE_ID = "core.custom-app-window"

const CUSTOM_APP_WINDOW_BOUNDS = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
}

const MAX_POPUPS_PER_APP = 5

type CustomWebAppWindowDependencies = {
  readonly getApp: (appId: CustomAppId) => CustomAppDto | null
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getPreloadPath: () => string
  readonly runtime: Pick<CustomWebAppRuntimeService, "destroyApp" | "destroyHost">
  readonly windowManager?: Pick<WindowManager, "attach" | "detach">
  readonly focusMainWindow?: () => void
}

export class CustomWebAppWindowService {
  private readonly windows = new Map<CustomAppId, BrowserWindow>()

  constructor(private readonly deps: CustomWebAppWindowDependencies) {}

  async open(appId: CustomAppId): Promise<void> {
    const app = this.deps.getApp(appId)
    if (!app) throw new Error("Custom app does not exist.")
    if (app.openMode !== "window") {
      throw new Error("Custom app does not use a dedicated window.")
    }
    const existing = this.windows.get(appId)
    if (existing && !existing.isDestroyed()) {
      this.focus(existing)
      return
    }

    const window = this.deps.createWindow({
      ...CUSTOM_APP_WINDOW_BOUNDS,
      show: false,
      title: `Synapse AI Studio ${app.name}`,
      webPreferences: {
        preload: this.deps.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.windows.set(appId, window)
    window.on("page-title-updated", (event) => event.preventDefault())
    window.once("ready-to-show", () => window.show())
    window.on("closed", () => {
      if (this.windows.get(appId) === window) this.windows.delete(appId)
      this.deps.runtime.destroyHost(window)
      this.deps.windowManager?.detach(`custom-app:${appId}`)
    })
    this.deps.windowManager?.attach(
      { id: `custom-app:${appId}`, role: "detail" },
      managedBrowserWindow(window, "detail"),
    )

    const url = new URL(this.deps.baseUrl())
    url.searchParams.set("window", "custom-app")
    url.searchParams.set("appId", appId)
    await window.loadURL(url.toString())
  }

  close(appId: CustomAppId): void {
    const window = this.windows.get(appId)
    this.deps.runtime.destroyApp(appId)
    if (window && !window.isDestroyed()) window.close()
    this.windows.delete(appId)
  }

  closeAll(): void {
    for (const appId of [...this.windows.keys()]) this.close(appId)
  }

  closeMissingApps(activeAppIds: ReadonlySet<string>): void {
    for (const appId of [...this.windows.keys()]) {
      if (!activeAppIds.has(appId)) this.close(appId)
    }
  }

  private focus(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }
}

export function planCustomWebAppWindowOpen(input: {
  readonly url: string
  readonly activePopupCount: number
}): { readonly action: "allow" | "deny" } {
  return {
    action: isAllowedCustomWebUrl(input.url) && input.activePopupCount < MAX_POPUPS_PER_APP
      ? "allow"
      : "deny",
  }
}
