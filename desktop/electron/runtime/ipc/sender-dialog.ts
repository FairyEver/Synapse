import { BrowserWindow, dialog, webContents } from "electron"
import type { IpcInvocationContext } from "./types"

export function getSenderWindow({ sender }: IpcInvocationContext): BrowserWindow | null {
  if (!sender || sender.isDestroyed()) return null
  const contents = webContents.fromId(sender.id)
  const window = contents && BrowserWindow.fromWebContents(contents)
  return window && !window.isDestroyed() ? window : null
}

async function showSenderDialog<T>(
  context: IpcInvocationContext,
  show: (parent?: BrowserWindow) => Promise<T>,
  cancelled: T,
): Promise<T> {
  if (!context.sender) return show()
  const parent = getSenderWindow(context)
  if (!parent) return cancelled
  try {
    const result = await show(parent)
    return parent.isDestroyed() || context.sender.isDestroyed() ? cancelled : result
  } catch (error) {
    if (parent.isDestroyed() || context.sender.isDestroyed()) return cancelled
    throw error
  }
}

export function showSenderOpenDialog(context: IpcInvocationContext, options: Electron.OpenDialogOptions) {
  return showSenderDialog(context, (parent) => parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options),
    { canceled: true, filePaths: [] })
}

export function showSenderSaveDialog(context: IpcInvocationContext, options: Electron.SaveDialogOptions) {
  return showSenderDialog(context, (parent) => parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options),
    { canceled: true, filePath: "" })
}
