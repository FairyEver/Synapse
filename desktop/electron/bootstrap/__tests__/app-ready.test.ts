import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
  const eventBus = {}
  const automation = {}
  const auditSink = {}
  const permissionGuard = {}
  const synapseSkillService = {}
  const windowManager = {}
  const registry = {
    get: vi.fn((id: string) => {
      if (id === "core.event-bus") return eventBus
      if (id === "core.automation") return automation
      if (id === "core.audit-sink") return auditSink
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.synapse-skill") return synapseSkillService
      if (id === "core.window-manager") return windowManager
      if (id === "knowledge-base.storage-migration-service") return {}
      throw new Error(`Unknown service: ${id}`)
    }),
    startBlocking: vi.fn(async () => ({ degraded: [] })),
    startBackground: vi.fn(async () => ({ degraded: [] })),
    stopAll: vi.fn(async () => undefined),
  }

  return {
    accountService: {
      onStateChanged: vi.fn(),
      refreshFromStorage: vi.fn(async () => ({ status: "anonymous" })),
      retryOfflineNow: vi.fn(),
      setEventBus: vi.fn(),
      setExternalUrlOpener: vi.fn(),
    },
    attachActivateHandler: vi.fn(),
    attachBeforeQuitHandler: vi.fn(),
    createAccountExternalUrlOpener: vi.fn(() => ({})),
    createIpcRegistry: vi.fn(),
    createMainWindow: vi.fn(),
    dialog: {
      showMessageBox: vi.fn(),
    },
    installStatusCacheService: {
      buildCache: vi.fn(async () => undefined),
    },
    editorInstallService: {
      addPreparedSourceProvider: vi.fn(),
    },
    liveConnectionService: {
      handleAccountState: vi.fn(),
      setEventBus: vi.fn(),
      setWebhookDeliveryHandler: vi.fn(),
    },
    logger,
    logStore: {
      dispose: vi.fn(async () => undefined),
    },
    registerAgentArtifactProtocol: vi.fn(),
    registry,
    synapseSkillService,
    windowManager,
  }
})

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  dialog: mocks.dialog,
}))

vi.mock("../../services/account-service", () => ({
  accountService: mocks.accountService,
}))

vi.mock("../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../services/editor-install-service", () => ({
  editorInstallService: mocks.editorInstallService,
}))

vi.mock("../../services/live-connection-service-instance", () => ({
  liveConnectionService: mocks.liveConnectionService,
}))

vi.mock("../../services/live-webhook-delivery-handler", () => ({
  LiveWebhookDeliveryHandler: vi.fn(),
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
  logStore: mocks.logStore,
}))

vi.mock("../account-external-opener", () => ({
  createAccountExternalUrlOpener: mocks.createAccountExternalUrlOpener,
}))

vi.mock("../agent-artifact-protocol", () => ({
  registerAgentArtifactProtocol: mocks.registerAgentArtifactProtocol,
}))

vi.mock("../app-events", () => ({
  attachActivateHandler: mocks.attachActivateHandler,
}))

vi.mock("../before-quit", () => ({
  attachBeforeQuitHandler: mocks.attachBeforeQuitHandler,
}))

vi.mock("../ipc-registry", () => ({
  createIpcRegistry: mocks.createIpcRegistry,
}))

vi.mock("../main-window", () => ({
  createMainWindow: mocks.createMainWindow,
}))

vi.mock("../registry", () => ({
  buildServiceRegistry: () => mocks.registry,
}))

import { initializeReadyApp } from "../app-ready"

describe("initializeReadyApp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates the normal main window for a generic startup", async () => {
    await initializeReadyApp({
      focusOrCreateMainWindow: vi.fn(),
      isAppQuitting: () => false,
      mainWindowState: { current: null },
      setAllowAppQuit: vi.fn(),
      setWindowManager: vi.fn(),
      startProtocolHandling: vi.fn(async () => 0),
    })

    expect(mocks.createMainWindow).toHaveBeenCalledWith({
      state: { current: null },
      windowManager: mocks.windowManager,
      isAppQuitting: expect.any(Function),
    })
    expect(mocks.editorInstallService.addPreparedSourceProvider).toHaveBeenCalledOnce()
    expect(mocks.registry.get).toHaveBeenCalledWith("core.synapse-skill")
    expect(mocks.registry.startBackground).toHaveBeenCalledOnce()
  })

  it("skips the normal main window before routing a cold-start install protocol URL", async () => {
    const startProtocolHandling = vi.fn(async (prepare: (handledAuthCallbacks: number) => Promise<void>) => {
      await prepare(0)
      return 1
    })

    await initializeReadyApp({
      focusOrCreateMainWindow: vi.fn(),
      isAppQuitting: () => false,
      mainWindowState: { current: null },
      setAllowAppQuit: vi.fn(),
      setWindowManager: vi.fn(),
      shouldCreateMainWindowBeforeProtocolHandling: () => false,
      startProtocolHandling,
    })

    expect(mocks.createMainWindow).not.toHaveBeenCalled()
    expect(startProtocolHandling).toHaveBeenCalledTimes(1)
  })
})
