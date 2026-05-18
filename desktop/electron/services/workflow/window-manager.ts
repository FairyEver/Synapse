import { BrowserWindow } from "electron"
import type { WindowManager } from "../../runtime/window"
import { managedBrowserWindow } from "../../runtime/window"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"

const logger = createMainLogger("service.workflow.window-manager")

export class WorkflowWindowManager {
  private readonly editorWindows = new Map<string, BrowserWindow>()
  private readonly runnerWindows = new Map<string, BrowserWindow>()
  private readonly healthServices = new Map<string, RendererHealthService>()

  constructor(private readonly mainWindowManager?: WindowManager) {}

  open(workflowId: string, baseUrl: string, runId?: string): BrowserWindow {
    const existing = this.editorWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      logger.info("workflow editor window reused", { workflowId, runId })
      this.sendToWindow(existing, "synapse:workflow:editor-refocus", { runId }, { workflowId, runId })
      existing.focus()
      this.closeRunnerWindow(workflowId, "workflow runner window closed after editor opened")
      return existing
    }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-editor", workflowId })
    if (runId) params.set("runId", runId)
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    void win.loadURL(url).catch((err: Error) => {
      logger.error("workflow editor window URL load failed", { workflowId, url, error: err.message })
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
      this.healthServices.get(windowId)?.detach()
      this.healthServices.delete(windowId)
      this.editorWindows.delete(workflowId)
    })
    this.editorWindows.set(workflowId, win)
    this.closeRunnerWindow(workflowId, "workflow runner window closed after editor opened")
    logger.info("workflow editor window opened", { workflowId, runId })
    return win
  }

  async openRunner(workflowId: string, runId: string, baseUrl: string): Promise<BrowserWindow> {
    const existing = this.runnerWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      logger.info("workflow runner window reused — switching run", { workflowId, newRunId: runId })
      this.sendToWindow(existing, "synapse:workflow:runner-switch-run", { runId }, { workflowId, runId })
      existing.focus()
      this.closeEditorWindow(workflowId, "workflow editor window closed after runner opened")
      return existing
    }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Runner",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-runner", workflowId, runId })
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`

    const windowId = `workflow-runner:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    const health = this.createHealthService(`renderer-health.runner.${workflowId}`)
    health.attach(win.webContents)
    this.healthServices.set(windowId, health)

    win.on("closed", () => {
      logger.info("workflow runner window closed", { workflowId })
      this.healthServices.get(windowId)?.detach()
      this.healthServices.delete(windowId)
      this.runnerWindows.delete(workflowId)
    })
    this.runnerWindows.set(workflowId, win)
    try {
      await win.loadURL(url)
    } catch (err) {
      logger.error("workflow runner window URL load failed", { workflowId, runId, url, error: err instanceof Error ? err.message : String(err) })
      this.healthServices.get(windowId)?.detach()
      this.healthServices.delete(windowId)
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

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const open = this.getOpenEditorIds()
    return open.length > 0
      ? { canSync: false, blockers: open.map((id) => `Workflow editor open: ${id}`) }
      : { canSync: true, blockers: [] }
  }

  private closeEditorWindow(workflowId: string, message: string): void {
    const editor = this.editorWindows.get(workflowId)
    if (editor && !editor.isDestroyed()) {
      logger.info(message, { workflowId })
      const windowId = `workflow-editor:${workflowId}`
      this.healthServices.get(windowId)?.detach()
      this.healthServices.delete(windowId)
      editor.destroy()
    }
    this.editorWindows.delete(workflowId)
  }

  private closeRunnerWindow(workflowId: string, message: string): void {
    const runner = this.runnerWindows.get(workflowId)
    if (runner && !runner.isDestroyed()) {
      logger.info(message, { workflowId })
      const windowId = `workflow-runner:${workflowId}`
      this.healthServices.get(windowId)?.detach()
      this.healthServices.delete(windowId)
      runner.destroy()
    }
    this.runnerWindows.delete(workflowId)
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
