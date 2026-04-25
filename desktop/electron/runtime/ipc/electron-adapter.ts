/**
 * Phase 0.3 — Electron IPC transport adapter.
 *
 * Wires IpcRegistry into ipcMain.handle for production use.
 * This is the ONLY allowed place outside tests to use ipcMain.handle.
 */

import { ipcMain } from "electron"

/**
 * Electron transport: installs handlers via ipcMain.handle.
 * Each installed handler returns a disposer that removes the listener.
 */
export function createElectronTransportInstall() {
  return (channel: string, invoker: (request: unknown) => Promise<unknown>) => {
    ipcMain.handle(channel, async (_event, request) => {
      return invoker(request)
    })
    return () => {
      ipcMain.removeHandler(channel)
    }
  }
}
