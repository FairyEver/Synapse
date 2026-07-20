import { BrowserWindow } from "electron"
import { DEFAULT_WINDOW_BOUNDS } from "../../../src/constants/defaults"
import type { WindowManager } from "../../runtime/window"
import { managedBrowserWindow } from "../../runtime/window"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"

const logger = createMainLogger("service.workflow.window-manager")
const WORKFLOW_EDITOR_WINDOW_BOUNDS = {
  width: 1350,
  height: 900,
  minWidth: DEFAULT_WINDOW_BOUNDS.minWidth,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}
type WorkflowDetailWindowType = "workflow-editor" | "workflow-runner"

interface WorkflowDetailWindowNavigationContext {
  readonly windowType: WorkflowDetailWindowType
  readonly workflowId: string
  readonly runId?: string
  readonly expectedUrl: string
}

export interface WorkflowEditorMutationState {
  readonly workflowId: string
  readonly dirty: boolean
  readonly saving: boolean
}

export class WorkflowWindowManager {
  private readonly editorWindows = new Map<string, BrowserWindow>()
  private readonly runnerWindows = new Map<string, BrowserWindow>()
  private readonly healthServices = new Map<string, RendererHealthService>()
  private readonly editorMutationStates = new Map<string, WorkflowEditorMutationState>()

  constructor(private readonly mainWindowManager?: WindowManager) {}

  async open(workflowId: string, baseUrl: string, runId?: string): Promise<BrowserWindow> {
    const existing = this.editorWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      logger.info("workflow editor window reused", { workflowId, runId })
      this.sendToWindow(existing, "synapse:workflow:editor-refocus", { runId }, { workflowId, runId })
      focusWorkflowWindow(existing)
      this.closeRunnerWindow(workflowId, "workflow runner window closed after editor opened")
      return existing
    }

    const win = new BrowserWindow({
      ...WORKFLOW_EDITOR_WINDOW_BOUNDS,
      title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-editor", workflowId })
    if (runId) params.set("runId", runId)
    const url = buildWorkflowDetailWindowUrl(baseUrl, params)
    attachWorkflowDetailWindowNavigationDiagnostics(win, {
      windowType: "workflow-editor",
      workflowId,
      runId,
      expectedUrl: url,
    })

    const windowId = `workflow-editor:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    const health = this.createHealthService(`renderer-health.editor.${workflowId}`)
    health.attach(win.webContents)
    this.healthServices.set(windowId, health)

    win.on("closed", () => {
      logger.info("workflow editor window closed", { workflowId })
      this.detachManagedWindow(windowId)
      this.editorWindows.delete(workflowId)
      this.editorMutationStates.delete(workflowId)
    })
    this.editorWindows.set(workflowId, win)
    this.editorMutationStates.set(workflowId, { workflowId, dirty: false, saving: false })
    try {
      await win.loadURL(url)
    } catch (err) {
      logger.error("workflow editor window URL load failed", { workflowId, url: sanitizeWorkflowDetailUrl(url), error: err instanceof Error ? err.message : String(err) })
      this.detachManagedWindow(windowId)
      this.editorWindows.delete(workflowId)
      if (!win.isDestroyed()) win.destroy()
      throw err
    }
    this.closeRunnerWindow(workflowId, "workflow runner window closed after editor opened")
    logger.info("workflow editor window opened", { workflowId, runId })
    return win
  }

  async openRunner(workflowId: string, runId: string, baseUrl: string): Promise<BrowserWindow> {
    const existing = this.runnerWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      logger.info("workflow runner window reused — switching run", { workflowId, newRunId: runId })
      this.sendToWindow(existing, "synapse:workflow:runner-switch-run", { runId }, { workflowId, runId })
      focusWorkflowWindow(existing)
      this.closeEditorWindow(workflowId, "workflow editor window closed after runner opened")
      return existing
    }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Runner",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-runner", workflowId, runId })
    const url = buildWorkflowDetailWindowUrl(baseUrl, params)
    attachWorkflowDetailWindowNavigationDiagnostics(win, {
      windowType: "workflow-runner",
      workflowId,
      runId,
      expectedUrl: url,
    })

    const windowId = `workflow-runner:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    const health = this.createHealthService(`renderer-health.runner.${workflowId}`)
    health.attach(win.webContents)
    this.healthServices.set(windowId, health)

    win.on("closed", () => {
      logger.info("workflow runner window closed", { workflowId })
      this.detachManagedWindow(windowId)
      this.runnerWindows.delete(workflowId)
    })
    this.runnerWindows.set(workflowId, win)
    try {
      await win.loadURL(url)
    } catch (err) {
      logger.error("workflow runner window URL load failed", { workflowId, runId, url: sanitizeWorkflowDetailUrl(url), error: err instanceof Error ? err.message : String(err) })
      this.detachManagedWindow(windowId)
      this.runnerWindows.delete(workflowId)
      if (!win.isDestroyed()) win.destroy()
      throw err
    }
    this.closeEditorWindow(workflowId, "workflow editor window closed after runner opened")
    logger.info("workflow runner window opened", { workflowId, runId })
    return win
  }

  forceClose(workflowId: string): void {
    this.closeEditorWindow(workflowId, "workflow editor window force-closed")
  }

  forceCloseAll(workflowId: string): void {
    logger.info("workflow force-close-all", { workflowId })
    this.forceClose(workflowId)
    this.closeRunnerWindow(workflowId, "workflow runner window force-closed")
  }

  getOpenEditorIds(): string[] {
    return [...this.editorWindows.entries()].filter(([, w]) => !w.isDestroyed()).map(([id]) => id)
  }

  updateEditorMutationState(state: WorkflowEditorMutationState): void {
    const editor = this.editorWindows.get(state.workflowId)
    if (!editor || editor.isDestroyed()) return
    this.editorMutationStates.set(state.workflowId, state)
  }

  getEditorMutationStates(): WorkflowEditorMutationState[] {
    const openIds = new Set(this.getOpenEditorIds())
    return Array.from(this.editorMutationStates.values()).filter((state) => openIds.has(state.workflowId))
  }

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const open = this.getOpenEditorIds()
    return open.length > 0
      ? { canSync: false, blockers: open.map((id) => `Workflow editor open: ${id}`) }
      : { canSync: true, blockers: [] }
  }

  private closeEditorWindow(workflowId: string, message: string): void {
    const editor = this.editorWindows.get(workflowId)
    if (editor && !editor.isDestroyed()) {
      // Use close() instead of destroy() to allow the renderer's beforeunload
      // handler to prevent closing when the editor has unsaved changes.
      editor.close()
      // If close was prevented (e.g. dirty editor), the window stays alive
      // and will be cleaned up by its 'closed' event handler when the user
      // eventually closes it. Don't detach health service or remove from map.
      if (!editor.isDestroyed()) {
        logger.info("editor close was prevented, window kept open", { workflowId })
        return
      }
      logger.info(message, { workflowId })
      const windowId = `workflow-editor:${workflowId}`
      this.detachManagedWindow(windowId)
    }
    this.editorWindows.delete(workflowId)
    this.editorMutationStates.delete(workflowId)
  }

  private closeRunnerWindow(workflowId: string, message: string): void {
    const runner = this.runnerWindows.get(workflowId)
    if (runner && !runner.isDestroyed()) {
      logger.info(message, { workflowId })
      const windowId = `workflow-runner:${workflowId}`
      this.detachManagedWindow(windowId)
      runner.destroy()
    }
    this.runnerWindows.delete(workflowId)
  }

  private detachManagedWindow(windowId: string): void {
    this.healthServices.get(windowId)?.detach()
    this.healthServices.delete(windowId)
    this.mainWindowManager?.detach(windowId)
  }

  private createHealthService(loggerName: string): RendererHealthService {
    return new RendererHealthService({
      logger: createMainLogger(loggerName),
      sendRendererMessage: (target, channel, payload) => {
        const sent = this.mainWindowManager?.broadcast(channel, payload, (window) => window.id === target.id) ?? 0
        if (sent === 0) {
          throw new Error("target window is not managed")
        }
      },
    })
  }

  private sendToWindow(
    target: BrowserWindow,
    channel: string,
    payload: unknown,
    meta: Record<string, unknown>,
  ): void {
    const sent = this.mainWindowManager?.broadcast(channel, payload, (window) => window.id === target.webContents.id) ?? 0
    if (sent === 0) {
      logger.warn("workflow window message skipped", { channel, ...meta })
    }
  }
}

function focusWorkflowWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.focus()
}

function buildWorkflowDetailWindowUrl(baseUrl: string, params: URLSearchParams): string {
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
}

function attachWorkflowDetailWindowNavigationDiagnostics(
  window: BrowserWindow,
  context: WorkflowDetailWindowNavigationContext,
): void {
  window.webContents.setWindowOpenHandler((details) => {
    logger.warn("workflow detail window popup blocked", {
      ...workflowDetailWindowLogMeta(context),
      attemptedUrl: sanitizeWorkflowDetailUrl(details.url),
    })
    return { action: "deny" }
  })

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isAllowedWorkflowDetailUrl(targetUrl, context)) return
    event.preventDefault()
    logger.warn("workflow detail window blocked unexpected navigation", {
      ...workflowDetailWindowLogMeta(context),
      attemptedUrl: sanitizeWorkflowDetailUrl(targetUrl),
    })
  })

  window.webContents.on("did-start-navigation", (_event, targetUrl, isInPlace, isMainFrame) => {
    if (!isMainFrame || isAllowedWorkflowDetailUrl(targetUrl, context)) return
    logger.warn("workflow detail window unexpected navigation started", {
      ...workflowDetailWindowLogMeta(context),
      attemptedUrl: sanitizeWorkflowDetailUrl(targetUrl),
      isInPlace,
      isMainFrame,
    })
  })

  window.webContents.on("did-navigate", (_event, targetUrl, httpResponseCode, httpStatusText) => {
    logger.info("workflow detail window did navigate", {
      ...workflowDetailWindowLogMeta(context),
      allowed: isAllowedWorkflowDetailUrl(targetUrl, context),
      httpResponseCode,
      httpStatusText,
      url: sanitizeWorkflowDetailUrl(targetUrl),
    })
  })

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    logger.warn("workflow detail window load failed", {
      ...workflowDetailWindowLogMeta(context),
      errorCode,
      errorDescription,
      isMainFrame,
      validatedUrl: sanitizeWorkflowDetailUrl(validatedUrl),
    })
  })
}

function workflowDetailWindowLogMeta(context: WorkflowDetailWindowNavigationContext): {
  readonly windowType: WorkflowDetailWindowType
  readonly workflowId: string
  readonly runId?: string
  readonly expectedUrl: string
} {
  return {
    windowType: context.windowType,
    workflowId: context.workflowId,
    runId: context.runId,
    expectedUrl: sanitizeWorkflowDetailUrl(context.expectedUrl),
  }
}

function isAllowedWorkflowDetailUrl(targetUrl: string, context: WorkflowDetailWindowNavigationContext): boolean {
  const target = parseUrl(targetUrl)
  const expected = parseUrl(context.expectedUrl)
  if (!target || !expected) return targetUrl === context.expectedUrl
  if (target.protocol !== expected.protocol) return false
  if (target.host !== expected.host) return false
  if (target.pathname !== expected.pathname) return false
  if (target.searchParams.get("window") !== context.windowType) return false
  if (target.searchParams.get("workflowId") !== context.workflowId) return false
  if (context.windowType === "workflow-runner" && target.searchParams.get("runId") !== context.runId) return false
  return true
}

function sanitizeWorkflowDetailUrl(value: string): string {
  const parsed = parseUrl(value)
  if (!parsed) return value.length > 500 ? `${value.slice(0, 500)}...[truncated ${value.length - 500} chars]` : value

  for (const [key] of parsed.searchParams) {
    if (key === "window" || key === "workflowId" || key === "runId") continue
    parsed.searchParams.set(key, "[redacted]")
  }
  return parsed.toString()
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
