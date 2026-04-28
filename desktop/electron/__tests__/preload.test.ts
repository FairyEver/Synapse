import { readFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseBridge } from "../../src/types/bridge"

const electronMock = vi.hoisted(() => {
  const state: { exposedBridge: SynapseBridge | null } = { exposedBridge: null }

  return {
    state,
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, bridge: unknown) => {
        if (key === "synapse") {
          state.exposedBridge = bridge as SynapseBridge
        }
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  }
})

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
}))

async function loadPreloadBridge(): Promise<SynapseBridge> {
  vi.resetModules()
  electronMock.state.exposedBridge = null
  electronMock.contextBridge.exposeInMainWorld.mockClear()
  electronMock.ipcRenderer.invoke.mockClear()
  electronMock.ipcRenderer.on.mockClear()
  electronMock.ipcRenderer.removeListener.mockClear()

  await import("../preload")

  if (!electronMock.state.exposedBridge) {
    throw new Error("preload did not expose the synapse bridge")
  }

  return electronMock.state.exposedBridge
}

describe("preload bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps preload free of local runtime imports for Electron sandbox loading", async () => {
    const source = await readFile(path.resolve(__dirname, "..", "preload.ts"), "utf8")
    const imports = source.match(/import[\s\S]*?from\s+["'][^"']+["']/g) ?? []
    const localRuntimeImports = imports.filter((statement) => {
      const moduleMatch = statement.match(/from\s+["']([^"']+)["']/)
      const modulePath = moduleMatch?.[1] ?? ""
      return !/^import\s+type\b/.test(statement.trim()) && modulePath.startsWith(".")
    })

    expect(localRuntimeImports).toEqual([])
  })

  it("subscribes repository listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.repository.onProgress(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:repository")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    expect(typeof wrapped).toBe("function")

    wrapped?.({}, {
      domain: "repository",
      type: "repository.updated",
      payload: { repositoryUuid: "wrong-type" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })
    wrapped?.({}, {
      domain: "repository",
      type: "repository.progress",
      payload: { repositoryUuid: "repo-1" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ repositoryUuid: "repo-1" })
  })

  it("subscribes data-store change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.dataStore.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:data-store")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "data-store",
      type: "data-store.changed",
      payload: { table: "notes" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ table: "notes" })
  })

  it("passes direct update event payloads through", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.updater.onStateChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:update:state-changed")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, { status: "downloaded" })

    expect(listener).toHaveBeenCalledWith({ status: "downloaded" })
  })
})
