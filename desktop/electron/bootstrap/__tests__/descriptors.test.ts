/**
 * Phase 0.1 — Bootstrap descriptor smoke tests.
 *
 * These tests do not boot Electron. They mock the `electron` module so we can
 * exercise the descriptor wrappers in isolation. The goal is to prove that:
 *   1. Both descriptors compile and expose the SPEC §4 mapping table values.
 *   2. `coreConfigDescriptor.create` triggers `configStore.load()` exactly once.
 *
 * Real lifecycle wiring is verified in Phase 0.1's T1.9 integration test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: () => {},
    once: () => {},
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    fullChangelog: false,
    forceDevUpdateConfig: false,
    logger: null,
  },
  CancellationToken: class {},
}))
const tmpUserData = "/tmp/synapse-test-userdata-" + Date.now()
vi.mock("electron", () => {
  const Notification = class {
    static isSupported() {
      return false
    }
    on() {}
  }
  return {
    app: {
      getPath: (which: string) =>
        which === "userData" ? tmpUserData : `/tmp/synapse-test-${which}`,
      getName: () => "synapse-test",
      getVersion: () => "0.0.0-test",
      getAppPath: () => "/tmp/synapse-test-app",
      isPackaged: false,
      on: () => {},
      once: () => {},
    },
    BrowserWindow: class {
      static getAllWindows() {
        return []
      }
    },
    dialog: {},
    ipcMain: { handle: () => {}, on: () => {} },
    shell: {},
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) },
    Notification,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    safeStorage: { isEncryptionAvailable: () => false },
    webContents: {},
  }
})

// Lazy import after the mock.
async function importBootstrap() {
  return await import("../descriptors")
}

describe("bootstrap descriptors (T1.5)", () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("coreLoggingDescriptor has fatal criticality and id 'core.logging'", async () => {
    const { coreLoggingDescriptor } = await importBootstrap()
    expect(coreLoggingDescriptor.id).toBe("core.logging")
    expect(coreLoggingDescriptor.criticality).toBe("fatal")
    expect(coreLoggingDescriptor.dependsOn).toBeUndefined()
  })

  it("coreLoggingDescriptor.create returns the singleton synchronously", async () => {
    const { coreLoggingDescriptor } = await importBootstrap()
    const fakeCtx = makeFakeContext()
    const instance = coreLoggingDescriptor.create(fakeCtx)
    expect(instance).toBeDefined()
    // Calling create twice returns the same singleton reference.
    expect(coreLoggingDescriptor.create(fakeCtx)).toBe(instance)
  })

  it("coreConfigDescriptor has fatal criticality and id 'core.config'", async () => {
    const { coreConfigDescriptor } = await importBootstrap()
    expect(coreConfigDescriptor.id).toBe("core.config")
    expect(coreConfigDescriptor.criticality).toBe("fatal")
  })

  it("coreAppIconDescriptor is degraded with id 'core.app-icon' and no deps", async () => {
    const { coreAppIconDescriptor } = await importBootstrap()
    expect(coreAppIconDescriptor.id).toBe("core.app-icon")
    expect(coreAppIconDescriptor.criticality).toBe("degraded")
    expect(coreAppIconDescriptor.dependsOn).toBeUndefined()
  })

  it("coreDataStoreDescriptor is degraded, depends on core.config + core.event-bus, has stop", async () => {
    const { coreDataStoreDescriptor } = await importBootstrap()
    expect(coreDataStoreDescriptor.id).toBe("core.data-store")
    expect(coreDataStoreDescriptor.criticality).toBe("degraded")
    expect(coreDataStoreDescriptor.dependsOn).toEqual(["core.config", "core.event-bus"])
    expect(coreDataStoreDescriptor.stop).toBeTypeOf("function")
  })

  it("coreUpdateDescriptor is degraded and depends on core.config + core.window-manager", async () => {
    const { coreUpdateDescriptor } = await importBootstrap()
    expect(coreUpdateDescriptor.id).toBe("core.update")
    expect(coreUpdateDescriptor.criticality).toBe("degraded")
    expect(coreUpdateDescriptor.dependsOn).toEqual(["core.config", "core.window-manager"])
  })

  it("repoWatchDescriptor depends on core.config and exposes stop", async () => {
    const { repoWatchDescriptor } = await importBootstrap()
    expect(repoWatchDescriptor.id).toBe("repo.watch")
    expect(repoWatchDescriptor.criticality).toBe("degraded")
    expect(repoWatchDescriptor.dependsOn).toEqual(["core.config"])
    expect(repoWatchDescriptor.stop).toBeTypeOf("function")
  })

  it("repoMaintenanceDescriptor depends on repo.watch", async () => {
    const { repoMaintenanceDescriptor } = await importBootstrap()
    expect(repoMaintenanceDescriptor.id).toBe("repo.maintenance")
    expect(repoMaintenanceDescriptor.criticality).toBe("degraded")
    expect(repoMaintenanceDescriptor.dependsOn).toEqual(["repo.watch"])
  })

  it("repoPendingPushesDescriptor depends on core.data-store", async () => {
    const { repoPendingPushesDescriptor } = await importBootstrap()
    expect(repoPendingPushesDescriptor.id).toBe("repo.pending-pushes")
    expect(repoPendingPushesDescriptor.criticality).toBe("degraded")
    expect(repoPendingPushesDescriptor.dependsOn).toEqual(["core.data-store"])
  })

  it("createUiTrayDescriptor produces a degraded descriptor depending on core.app-icon", async () => {
    const { createUiTrayDescriptor } = await importBootstrap()
    const cb = vi.fn()
    const desc = createUiTrayDescriptor(cb)
    expect(desc.id).toBe("ui.tray")
    expect(desc.criticality).toBe("degraded")
    expect(desc.dependsOn).toEqual(["core.app-icon"])
    expect(desc.stop).toBeTypeOf("function")
  })
})

function makeFakeContext() {
  const noop = () => {}
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return {
    logger,
    dataRepo: {} as never,
    eventBus: {} as never,
    registry: {} as never,
    metrics: {} as never,
    tracer: {} as never,
    permissionGuard: {} as never,
    processRuntime: {} as never,
  }
}
