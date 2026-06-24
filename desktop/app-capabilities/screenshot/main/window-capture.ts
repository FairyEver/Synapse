import { BrowserWindow } from "electron"

export type ScreenshotWindowStateContext = {
  readonly targetPoint?: {
    readonly x: number
    readonly y: number
  }
}

export async function runWithScreenshotWindowState<T>(
  options: { readonly hideCurrentWindow?: boolean },
  operation: (context: ScreenshotWindowStateContext) => Promise<T>,
): Promise<T> {
  const focusedWindow = usableFocusedWindow()
  const context = focusedWindow ? { targetPoint: windowCenter(focusedWindow) } : {}
  const hiddenWindow = options.hideCurrentWindow === true ? focusedWindow : null

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
