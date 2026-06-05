/**
 * Phase 0.1 — App-wide event handlers (uncaught/rejection logging,
 * second-instance, activate).
 *
 * Repository disappearance is broadcast by repo.watch through EventBus as a
 * `repository.updated` event, keeping this module focused on app-level handlers.
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

export function registerAuthProtocol(): void {
  let registered: boolean
  let hasDevEntrypoint = false
  if (process.defaultApp) {
    const args = process.argv[1] ? [process.argv[1]] : []
    hasDevEntrypoint = args.length > 0
    registered = app.setAsDefaultProtocolClient("synapse", process.execPath, args)
  } else {
    registered = app.setAsDefaultProtocolClient("synapse")
  }
  if (!registered) {
    logger.warn("Failed to register synapse:// protocol handler.", {
      defaultApp: Boolean(process.defaultApp),
      hasDevEntrypoint,
      hint: "scripts/fix-dev-protocol.sh",
    })
  }
}

export function attachOpenUrlHandler(handleUrl: (url: string) => void): void {
  app.on("open-url", (event, url) => {
    event.preventDefault()
    handleUrl(url)
  })
}

export function attachSecondInstanceProtocolHandler(handleUrl: (url: string) => void): void {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((item) => item.startsWith("synapse://"))
    if (url) handleUrl(url)
  })
}

export function attachActivateHandler(showOrCreate: () => void): void {
  app.on("activate", () => {
    showOrCreate()
  })
}
