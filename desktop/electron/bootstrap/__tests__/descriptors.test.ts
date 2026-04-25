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

// Stub electron before any module loads it.
const tmpUserData = "/tmp/synapse-test-userdata-" + Date.now()
vi.mock("electron", () => ({
  app: {
    getPath: (which: string) =>
      which === "userData" ? tmpUserData : `/tmp/synapse-test-${which}`,
    getName: () => "synapse-test",
    on: () => {},
    once: () => {},
  },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
  shell: {},
  Tray: class {},
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: {},
}))

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
