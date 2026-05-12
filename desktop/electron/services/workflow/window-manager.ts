import { BrowserWindow } from "electron"
import type { WindowManager } from "../../runtime/window"
import { managedBrowserWindow } from "../../runtime/window"

export class WorkflowWindowManager {
  private readonly editorWindows = new Map<string, BrowserWindow>()
  private readonly runnerWindows = new Map<string, BrowserWindow>()

  constructor(private readonly mainWindowManager?: WindowManager) {}

  open(workflowId: string, baseUrl: string, runId?: string): BrowserWindow {
    const existing = this.editorWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) { existing.focus(); return existing }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-editor", workflowId })
    if (runId) params.set("runId", runId)
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    void win.loadURL(url)

    const windowId = `workflow-editor:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    win.on("closed", () => this.editorWindows.delete(workflowId))
    this.editorWindows.set(workflowId, win)
    return win
  }

  openRunner(workflowId: string, runId: string, baseUrl: string): BrowserWindow {
    const existing = this.runnerWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      existing.webContents.send("synapse:workflow:runner-switch-run", { runId })
      existing.focus()
      return existing
    }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Runner",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-runner", workflowId, runId })
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    void win.loadURL(url)

    const windowId = `workflow-runner:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    win.on("closed", () => this.runnerWindows.delete(workflowId))
    this.runnerWindows.set(workflowId, win)
    return win
  }

  focusEditor(workflowId: string): boolean {
    const win = this.editorWindows.get(workflowId)
    if (win && !win.isDestroyed()) { win.focus(); return true }
    return false
  }

  forceClose(workflowId: string): void {
    const editor = this.editorWindows.get(workflowId)
    if (editor && !editor.isDestroyed()) editor.destroy()
    this.editorWindows.delete(workflowId)
  }

  forceCloseAll(workflowId: string): void {
    this.forceClose(workflowId)
    const runner = this.runnerWindows.get(workflowId)
    if (runner && !runner.isDestroyed()) runner.destroy()
    this.runnerWindows.delete(workflowId)
  }

  hasActiveRun(workflowId: string): boolean {
    const win = this.runnerWindows.get(workflowId)
    return !!win && !win.isDestroyed()
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
}
