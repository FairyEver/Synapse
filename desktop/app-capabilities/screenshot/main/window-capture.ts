import { BrowserWindow } from "electron"

export type ScreenshotWindowStateContext = {
  readonly targetPoint?: {
    readonly x: number
    readonly y: number
  }
}

export async function runWithScreenshotWindowState<T>(
  options: { readonly hideCurrentWindow?: boolean; readonly senderWebContentsId?: number },
  operation: (context: ScreenshotWindowStateContext) => Promise<T>,
): Promise<T> {
  const targetWindow = usableSenderWindow(options.senderWebContentsId) ?? usableFocusedWindow()
  const context = targetWindow ? { targetPoint: windowCenter(targetWindow) } : {}
  const hiddenWindow = options.hideCurrentWindow === true ? targetWindow : null

  try {
    if (hiddenWindow) {
      hiddenWindow.hide()
      await waitForWindowTransition()
    }
    return await operation(context)
  } finally {
    restoreWindow(hiddenWindow)
  }
}

export function waitForWindowTransition(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

function usableFocusedWindow(): BrowserWindow | null {
  const target = BrowserWindow.getFocusedWindow()
  if (!target || target.isDestroyed() || !target.isVisible()) return null
  return target
}

function usableSenderWindow(senderWebContentsId: number | undefined): BrowserWindow | null {
  if (senderWebContentsId === undefined) return null
  const target = BrowserWindow.getAllWindows().find((window) => window.webContents.id === senderWebContentsId)
  if (!target || target.isDestroyed() || !target.isVisible()) return null
  return target
}

function restoreWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  window.show()
}

function windowCenter(window: BrowserWindow): { x: number; y: number } {
  const bounds = window.getBounds()
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  }
}
