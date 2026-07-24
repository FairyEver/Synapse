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
import type { SynapseActionRouter } from "./capabilities/action-router"
import { accountService } from "./services/account-service"
import { createMainLogger } from "./services/log-store"
import { skillRepositoryInstallWindowService } from "./services/skill-repository-install-window-service"
import { updateService } from "./services/update-service"
import {
  resolveScriptRuntimeSmokeBootstrap,
  startScriptRuntimeSmokeBootstrap,
} from "./script-runtime-smoke-bootstrap"

const logger = createMainLogger("main")
const mainWindowState = createMainWindowState()
let allowAppQuit = false
let processLevelCleanup: (() => Promise<void>) | undefined
let windowManager: WindowManager | undefined
let protocolActionRouter: SynapseActionRouter | undefined
const scriptRuntimeSmokeConfig = resolveScriptRuntimeSmokeBootstrap(process.env)

function focusOrCreateMainWindow(): void {
  showOrCreateMainWindow({
    state: mainWindowState,
    windowManager,
    isAppQuitting: () => allowAppQuit,
  })
}

if (scriptRuntimeSmokeConfig) {
  app.on("window-all-closed", () => {})
  void startScriptRuntimeSmokeBootstrap({
    config: scriptRuntimeSmokeConfig,
    executablePath: app.getPath("exe"),
    whenReady: () => app.whenReady(),
    runSmoke: async (executablePath) => {
      const { runScriptRuntimeSmoke } = await import("./script-runtime-smoke.js")
      await runScriptRuntimeSmoke(executablePath)
    },
    exit: (code) => app.exit(code),
    logger,
  })
} else {
  startSynapse()
}

function startSynapse(): void {
  const protocolRouter = createProtocolUrlRouter({
    focusMainWindow: focusOrCreateMainWindow,
    handleAuthCallback: (url) => accountService.handleAuthCallback(url),
    logger,
    openSkillRepositoryInstallWindow: (request) => skillRepositoryInstallWindowService.open(request),
    publishUpdateOpenRequest: (automatic) => updateService.publishUpdateOpenRequest(automatic),
    verifyUpdateIntent: (token) => updateService.verifyUpdateIntent(token),
    dispatchAppAction: async (capabilityId, params) => {
      if (!protocolActionRouter) throw new Error("应用能力暂不可用")
      return protocolActionRouter.dispatch(capabilityId, params, {
        source: "app.deep_link",
        actor: { kind: "user", id: "app-deep-link" },
      })
    },
    showAppDeepLinkError: (message) => dialog.showErrorBox("无法处理应用链接", message),
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
        setProtocolActionRouter: (router) => {
          protocolActionRouter = router
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
}
