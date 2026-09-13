import type { BrowserWindow } from "electron"

import type { ManagedWindow, WindowRole } from "./manager"

function managedBrowserWindow(window: BrowserWindow, role: WindowRole): ManagedWindow {
  return {
    id: window.webContents.id,
    role,
    isDestroyed: () => window.isDestroyed(),
    isVisible: () => window.isVisible(),
    isMinimized: () => window.isMinimized(),
    show: () => window.show(),
    focus: () => window.focus(),
    restore: () => window.restore(),
    send: (channel, payload) => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return
      // 窗口仍存活时，导航或渲染进程退出也可能使主帧失效。
      const frame = window.webContents.mainFrame
      if (frame.isDestroyed() || frame.detached) return
      frame.send(channel, payload)
    },
    close: () => window.close(),
  }
}

export { managedBrowserWindow }
