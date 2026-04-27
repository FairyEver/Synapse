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
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    },
    close: () => window.close(),
  }
}

export { managedBrowserWindow }
