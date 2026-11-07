import {
  customWebAppViewStateSchema,
  type CustomAppDto,
  type CustomAppId,
  type CustomWebAppNavigationAction,
  type CustomWebAppViewState,
} from "@synapse/shared/custom-apps-contracts"
import {
  BrowserWindow,
  WebContentsView,
  type Session,
  type WebContents,
} from "electron"

import type { EventBus } from "../../runtime/event-bus"
import { isAllowedCustomWebUrl, getCustomWebSession } from "./web-session"
import { planCustomWebAppWindowOpen } from "./window-service"

export const CUSTOM_WEB_APP_RUNTIME_SERVICE_ID = "core.custom-app-web-runtime"

export type WebViewBounds = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type RuntimeDependencies = {
  readonly getApp: (appId: CustomAppId) => CustomAppDto | null
  readonly getSession?: () => Session
  readonly createView?: () => WebContentsView
  readonly openExternal?: (url: string) => Promise<void>
  readonly eventBus?: Pick<EventBus, "emit">
  readonly getAllWindows?: () => BrowserWindow[]
}

type ViewRecord = {
  readonly view: WebContentsView
  readonly state: CustomWebAppViewState
  loaded: boolean
  popupCount: number
  readonly popups: Set<BrowserWindow>
}

type HostState = {
  readonly views: Map<CustomAppId, ViewRecord>
  currentAppId: CustomAppId | null
  occluded: boolean
  bounds: WebViewBounds | null
}

const EMPTY_STATE: CustomWebAppViewState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  currentUrl: null,
  error: "none",
}

export class CustomWebAppRuntimeService {
  private readonly hosts = new WeakMap<BrowserWindow, HostState>()

  constructor(private readonly deps: RuntimeDependencies) {}

  async attach(host: BrowserWindow, appId: CustomAppId): Promise<void> {
    const app = this.deps.getApp(appId)
    if (!app) throw new Error("Custom app does not exist.")
    const hostState = this.hostState(host)
    if (hostState.currentAppId === appId) {
      this.applyVisibility(host, hostState)
      return
    }

    if (hostState.currentAppId) this.removeCurrentView(host, hostState)
    const record = hostState.views.get(appId) ?? this.createRecord(host, app)
    hostState.views.set(appId, record)
    hostState.currentAppId = appId
    host.contentView.addChildView(record.view)
    record.view.setVisible(!hostState.occluded)
    if (hostState.bounds) record.view.setBounds(this.clampBounds(host, hostState.bounds))
    if (!record.loaded) {
      record.loaded = true
      await record.view.webContents.loadURL(app.startUrl)
      this.refreshState(host, appId, record)
    }
    this.emitState(host, appId, record.state)
  }

  setBounds(host: BrowserWindow, bounds: WebViewBounds): void {
    const hostState = this.hostState(host)
    const nextBounds = this.clampBounds(host, this.scaleRendererBounds(host, bounds))
    hostState.bounds = nextBounds
    const record = hostState.currentAppId ? hostState.views.get(hostState.currentAppId) : null
    record?.view.setBounds(nextBounds)
  }

  detach(host: BrowserWindow): void {
    const hostState = this.hosts.get(host)
    if (!hostState) return
    this.removeCurrentView(host, hostState)
  }

  setOccluded(host: BrowserWindow, occluded: boolean): void {
    const hostState = this.hostState(host)
    hostState.occluded = occluded
    this.applyVisibility(host, hostState)
  }

  async navigate(host: BrowserWindow, action: CustomWebAppNavigationAction): Promise<void> {
    const hostState = this.hosts.get(host)
    const record = hostState?.currentAppId ? hostState.views.get(hostState.currentAppId) : null
    if (!record || !hostState?.currentAppId) return
    if (action === "back") record.view.webContents.navigationHistory.goBack()
    else if (action === "forward") record.view.webContents.navigationHistory.goForward()
    else if (action === "reload") record.view.webContents.reload()
    else {
      const currentUrl = record.view.webContents.getURL()
      if (!isAllowedCustomWebUrl(currentUrl) || !this.deps.openExternal) return
      await this.deps.openExternal(currentUrl)
    }
    this.refreshState(host, hostState.currentAppId, record)
  }

  state(host: BrowserWindow): CustomWebAppViewState {
    const hostState = this.hosts.get(host)
    return hostState?.currentAppId
      ? { ...(hostState.views.get(hostState.currentAppId)?.state ?? EMPTY_STATE) }
      : { ...EMPTY_STATE }
  }

  appIdForHost(host: BrowserWindow): CustomAppId | null {
    return this.hosts.get(host)?.currentAppId ?? null
  }

  destroyApp(appId: CustomAppId): void {
    for (const host of (this.deps.getAllWindows ?? BrowserWindow.getAllWindows)()) {
      const hostState = this.hosts.get(host)
      const record = hostState?.views.get(appId)
      if (!hostState || !record) continue
      if (hostState.currentAppId === appId) this.removeCurrentView(host, hostState)
      else host.contentView.removeChildView(record.view)
      closePopups(record)
      record.view.webContents.close()
      hostState.views.delete(appId)
    }
  }

  destroyHost(host: BrowserWindow): void {
    const hostState = this.hosts.get(host)
    if (!hostState) return
    for (const record of hostState.views.values()) {
      host.contentView.removeChildView(record.view)
      closePopups(record)
      record.view.webContents.close()
    }
    hostState.views.clear()
    hostState.currentAppId = null
    this.hosts.delete(host)
  }

  destroyAll(): void {
    for (const host of (this.deps.getAllWindows ?? BrowserWindow.getAllWindows)()) {
      const hostState = this.hosts.get(host)
      if (!hostState) continue
      for (const record of hostState.views.values()) {
        host.contentView.removeChildView(record.view)
        closePopups(record)
        record.view.webContents.close()
      }
      hostState.views.clear()
      hostState.currentAppId = null
    }
  }

  private hostState(host: BrowserWindow): HostState {
    let state = this.hosts.get(host)
    if (!state) {
      state = { views: new Map(), currentAppId: null, occluded: false, bounds: null }
      this.hosts.set(host, state)
    }
    return state
  }

  private createRecord(host: BrowserWindow, app: CustomAppDto): ViewRecord {
    const view = this.deps.createView?.() ?? new WebContentsView({
      webPreferences: {
        session: (this.deps.getSession ?? getCustomWebSession)(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    const state = { ...EMPTY_STATE }
    const record: ViewRecord = {
      view,
      state,
      loaded: false,
      popupCount: 0,
      popups: new Set(),
    }

    view.webContents.on("did-navigate", (_event, url) => {
      record.state.currentUrl = isAllowedCustomWebUrl(url) ? url : record.state.currentUrl
      this.refreshState(host, app.id, record)
    })
    view.webContents.on("did-navigate-in-page", (_event, url) => {
      record.state.currentUrl = isAllowedCustomWebUrl(url) ? url : record.state.currentUrl
      this.refreshState(host, app.id, record)
    })
    view.webContents.on("did-start-loading", () => {
      record.state.isLoading = true
      record.state.error = "none"
      this.refreshState(host, app.id, record)
    })
    view.webContents.on("did-stop-loading", () => {
      record.state.isLoading = false
      this.refreshState(host, app.id, record)
    })
    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      record.state.isLoading = false
      record.state.error = /cert|certificate/iu.test(errorDescription) ? "certificate" : "load_failed"
      this.refreshState(host, app.id, record)
    })
    view.webContents.on("page-title-updated", (event) => {
      event.preventDefault()
    })
    this.hardenWebContents(record, view.webContents)
    return record
  }

  private hardenWebContents(
    record: ViewRecord,
    webContents: WebContents,
  ): void {
    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedCustomWebUrl(url)) event.preventDefault()
    })
    webContents.on("will-redirect", (event, url) => {
      if (!isAllowedCustomWebUrl(url)) event.preventDefault()
    })
    webContents.setWindowOpenHandler(({ url }) => {
      if (planCustomWebAppWindowOpen({ url, activePopupCount: record.popupCount }).action === "deny") {
        return { action: "deny" }
      }
      record.popupCount += 1
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            session: (this.deps.getSession ?? getCustomWebSession)(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      }
    })
    webContents.on("did-create-window", (childWindow) => {
      record.popups.add(childWindow)
      this.hardenWebContents(record, childWindow.webContents)
      childWindow.once("closed", () => {
        record.popups.delete(childWindow)
        record.popupCount = Math.max(0, record.popupCount - 1)
      })
    })
  }

  private refreshState(host: BrowserWindow, appId: CustomAppId, record: ViewRecord): void {
    record.state.canGoBack = record.view.webContents.navigationHistory.canGoBack()
    record.state.canGoForward = record.view.webContents.navigationHistory.canGoForward()
    record.state.currentUrl = record.state.currentUrl ?? (record.view.webContents.getURL() || null)
    const validated = customWebAppViewStateSchema.parse(record.state)
    Object.assign(record.state, validated)
    this.emitState(host, appId, validated)
  }

  private emitState(host: BrowserWindow, appId: CustomAppId, state: CustomWebAppViewState): void {
    this.deps.eventBus?.emit({
      domain: "account",
      type: "custom-apps.view.changed",
      payload: { appId, state },
      timestamp: new Date().toISOString(),
      scope: { rendererIds: [host.webContents.id] },
    })
  }

  private removeCurrentView(host: BrowserWindow, hostState: HostState): void {
    if (!hostState.currentAppId) return
    const record = hostState.views.get(hostState.currentAppId)
    if (record) {
      host.contentView.removeChildView(record.view)
      record.view.setVisible(false)
    }
    hostState.currentAppId = null
  }

  private applyVisibility(host: BrowserWindow, hostState: HostState): void {
    const record = hostState.currentAppId ? hostState.views.get(hostState.currentAppId) : null
    record?.view.setVisible(!hostState.occluded)
  }

  private clampBounds(host: BrowserWindow, bounds: WebViewBounds): WebViewBounds {
    const content = host.getContentBounds()
    const x = clamp(bounds.x, 0, content.width)
    const y = clamp(bounds.y, 0, content.height)
    return {
      x,
      y,
      width: clamp(bounds.width, 0, Math.max(0, content.width - x)),
      height: clamp(bounds.height, 0, Math.max(0, content.height - y)),
    }
  }

  private scaleRendererBounds(host: BrowserWindow, bounds: WebViewBounds): WebViewBounds {
    // DOM rectangles are zoomed CSS pixels; WebContentsView bounds use window DIP.
    const zoomFactor = host.webContents.getZoomFactor()
    const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
    return {
      x: bounds.x * scale,
      y: bounds.y * scale,
      width: bounds.width * scale,
      height: bounds.height * scale,
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function closePopups(record: ViewRecord): void {
  for (const popup of record.popups) {
    if (!popup.isDestroyed()) popup.close()
  }
  record.popups.clear()
  record.popupCount = 0
}
