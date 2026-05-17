/**
 * Phase 0.1 — App-wide event handlers (uncaught/rejection logging,
 * second-instance, activate).
 *
 * Note: The repository-disappeared broadcast (today's
 * `webContents.send(SYNAPSE_IPC_CHANNELS.repository.updated, ...)`) deliberately
 * stays in `main.ts` until Phase 0.4 (T4.5) replaces it with EventBus. Moving
 * the bare `webContents.send` into `bootstrap/` would violate the SPEC §1 hard
 * constraint "禁止裸 webContents.send → 必须通过 EventBus" outside the allowed
 * homes; keeping it in the entry-point preserves the count of forbidden calls
 * (it stays at 1, soon to drop to 0).
 */

import { app } from "electron"
import { createMainLogger } from "../services/log-store"
import type { MainWindowState } from "./main-window"

const logger = createMainLogger("bootstrap.app-events")
const WINDOWS_APP_USER_MODEL_ID = "com.fairyever.synapse"

export function configureWindowsAppIdentity(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "win32") return
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

export function attachProcessLevelLogging(): void {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception in main process.", error)
    app.exit(1)
  })

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection in main process.", reason)
    app.exit(1)
  })
}

export function attachSecondInstanceFocus(state: MainWindowState): void {
  app.on("second-instance", () => {
    const window = state.current
    if (!window) {
      return
    }
    if (!window.isVisible()) window.show()
    if (window.isMinimized()) window.restore()
    logger.info("A second instance was requested. Focusing the existing window.")
    window.focus()
  })
}

export function attachActivateHandler(showOrCreate: () => void): void {
  app.on("activate", () => {
    showOrCreate()
  })
}
