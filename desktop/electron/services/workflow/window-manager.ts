import { BrowserWindow } from "electron"

export class WorkflowWindowManager {
  private readonly windows = new Map<string, BrowserWindow>()

  open(workflowId: string, baseUrl: string): BrowserWindow {
    const existing = this.windows.get(workflowId)
    if (existing && !existing.isDestroyed()) { existing.focus(); return existing }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const url = `${baseUrl}?window=workflow-editor&workflowId=${encodeURIComponent(workflowId)}`
    void win.loadURL(url)

    win.on("close", (e) => { e.preventDefault(); win.webContents.send("synapse:workflow:editor-close-requested") })
    win.on("closed", () => this.windows.delete(workflowId))
    this.windows.set(workflowId, win)
    return win
  }

  forceClose(workflowId: string): void {
    const win = this.windows.get(workflowId)
    if (win && !win.isDestroyed()) win.destroy()
    this.windows.delete(workflowId)
  }

  getOpenEditorIds(): string[] {
    return [...this.windows.entries()].filter(([, w]) => !w.isDestroyed()).map(([id]) => id)
  }

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const open = this.getOpenEditorIds()
    return open.length > 0
      ? { canSync: false, blockers: open.map((id) => `Workflow editor open: ${id}`) }
      : { canSync: true, blockers: [] }
  }
}
