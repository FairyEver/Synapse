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
import { isSynapseProtocolUrl } from "./protocol-router"

const logger = createMainLogger("bootstrap.app-events")
const WINDOWS_APP_USER_MODEL_ID = "com.fairyever.synapse"
const FATAL_CLEANUP_TIMEOUT_MS = 3_000

export function configureWindowsAppIdentity(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "win32") return
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

export interface ProcessLevelLoggingDeps {
  readonly cleanupBeforeExit?: () => Promise<void> | void
  readonly cleanupTimeoutMs?: number
}

export function attachProcessLevelLogging(deps: ProcessLevelLoggingDeps = {}): void {
  let fatalExitRequested = false

  const exitAfterCleanup = (message: string, reason: unknown) => {
    logger.error(message, reason)
    if (fatalExitRequested) {
      app.exit(1)
      return
    }

    fatalExitRequested = true
    void runFatalCleanup(deps).finally(() => {
      app.exit(1)
    })
  }

  process.on("uncaughtException", (error) => {
    exitAfterCleanup("Uncaught exception in main process.", error)
  })

  process.on("unhandledRejection", (reason) => {
    exitAfterCleanup("Unhandled rejection in main process.", reason)
  })
}

async function runFatalCleanup(deps: ProcessLevelLoggingDeps): Promise<void> {
  if (!deps.cleanupBeforeExit) return

  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      Promise.resolve(deps.cleanupBeforeExit()),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, deps.cleanupTimeoutMs ?? FATAL_CLEANUP_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    logger.warn("Fatal-exit cleanup failed.", { error })
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function attachSecondInstanceFocus(
  state: MainWindowState,
  shouldFocus: (argv: string[]) => boolean = () => true,
): void {
  app.on("second-instance", (_event, argv) => {
    if (!shouldFocus(argv)) return
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
      hint: "scripts/manual/fix-dev-protocol.sh",
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
    for (const url of argv.filter(isSynapseProtocolUrl)) {
      handleUrl(url)
    }
  })
}

export function attachActivateHandler(showOrCreate: () => void): void {
  app.on("activate", () => {
    showOrCreate()
  })
}
