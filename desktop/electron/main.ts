/**
 * Synapse main process entry point.
 *
 * Main only orchestrates lifecycle. Bootstrap and runtime modules own behavior.
 */

import { app, dialog } from "electron"

import {
  attachOpenUrlHandler,
  attachProcessLevelLogging,
  attachSecondInstanceFocus,
  attachSecondInstanceProtocolHandler,
  clearStaleSingletonLock,
  configureWindowsAppIdentity,
  createMainWindowState,
  createProtocolUrlRouter,
  initializeReadyApp,
  isSynapseProtocolUrl,
  registerAgentArtifactProtocolScheme,
  registerAuthProtocol,
  shouldFocusMainForSecondInstance,
  showOrCreateMainWindow,
} from "./bootstrap"
import { formatStartupFailureDialogMessage } from "./bootstrap/startup-error"
import type { WindowManager } from "./runtime/window"
import { accountService } from "./services/account-service"
import { createMainLogger } from "./services/log-store"
import { skillRepositoryInstallWindowService } from "./services/skill-repository-install-window-service"

const logger = createMainLogger("main")
const mainWindowState = createMainWindowState()
let allowAppQuit = false
let processLevelCleanup: (() => Promise<void>) | undefined
let windowManager: WindowManager | undefined

function focusOrCreateMainWindow(): void {
  showOrCreateMainWindow({
    state: mainWindowState,
    windowManager,
    isAppQuitting: () => allowAppQuit,
  })
}

const protocolRouter = createProtocolUrlRouter({
  focusMainWindow: focusOrCreateMainWindow,
  handleAuthCallback: (url) => accountService.handleAuthCallback(url),
  logger,
  openSkillRepositoryInstallWindow: (request) => skillRepositoryInstallWindowService.open(request),
}, process.argv.filter(isSynapseProtocolUrl))

attachProcessLevelLogging({
  cleanupBeforeExit: () => processLevelCleanup?.(),
})
configureWindowsAppIdentity()
registerAgentArtifactProtocolScheme()
registerAuthProtocol()

let gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock && clearStaleSingletonLock()) {
  gotSingleInstanceLock = app.requestSingleInstanceLock()
}

if (!gotSingleInstanceLock) {
  console.error("[Synapse] Another instance is already running. Exiting.")
  logger.warn("Another Synapse instance is already running. Exiting current process.")
  app.quit()
} else {
  attachSecondInstanceFocus(mainWindowState, shouldFocusMainForSecondInstance)
  attachOpenUrlHandler(protocolRouter.enqueue)
  attachSecondInstanceProtocolHandler(protocolRouter.enqueue)

  app.whenReady()
    .then(() => initializeReadyApp({
      focusOrCreateMainWindow,
      isAppQuitting: () => allowAppQuit,
      mainWindowState,
      setAllowAppQuit: (value) => {
        allowAppQuit = value
      },
      setProcessLevelCleanup: (cleanup) => {
        processLevelCleanup = cleanup
      },
      setWindowManager: (manager) => {
        windowManager = manager
      },
      shouldCreateMainWindowBeforeProtocolHandling: protocolRouter.shouldCreateMainWindowBeforeStart,
      startProtocolHandling: protocolRouter.start,
    }))
    .catch((error) => {
      logger.error("Failed to initialize app.", error)
      dialog.showErrorBox("Synapse AI Studio 启动失败", formatStartupFailureDialogMessage(error))
      app.quit()
    })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
