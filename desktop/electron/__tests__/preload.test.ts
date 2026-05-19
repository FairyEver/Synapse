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

  it("subscribes database change listeners to the EventBus domain channel", async () => {
    const bridge = await loadPreloadBridge()
    const listener = vi.fn()

    bridge.database.onChanged(listener)

    expect(electronMock.ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(electronMock.ipcRenderer.on.mock.calls[0]?.[0]).toBe("synapse:events:database")

    const wrapped = electronMock.ipcRenderer.on.mock.calls[0]?.[1]
    wrapped?.({}, {
      domain: "database",
      type: "database.changed",
      payload: { table: "notes" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(listener).toHaveBeenCalledWith({ table: "notes" })
  })

  it("maps table description updates to the database IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.database.databaseTableUpdate({
      table: "customer_orders",
      description: "客户订单",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:database:table:update",
      {
        table: "customer_orders",
        description: "客户订单",
      },
    )
  })

  it("writes a renderer IPC failure log when bridge invoke rejects", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("main failed")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:config:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("main failed")

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:log:write",
      expect.objectContaining({
        level: "error",
        category: "renderer.ipc",
        message: "IPC invoke failed.",
        details: expect.objectContaining({
          channel: "synapse:config:get",
          error: "main failed",
        }),
      }),
    )
  })

  it("sanitizes renderer IPC failure log errors", async () => {
    const bridge = await loadPreloadBridge()
    const failure = new Error("token=sk-secret Bearer abc.def at /Users/liyang/private/file.ts")
    electronMock.ipcRenderer.invoke.mockImplementation((channel: string) => {
      if (channel === "synapse:config:get") {
        return Promise.reject(failure)
      }
      return Promise.resolve(undefined)
    })

    await expect(bridge.config.get()).rejects.toThrow("token=sk-secret")

    const logCall = electronMock.ipcRenderer.invoke.mock.calls.find(([channel]) =>
      channel === "synapse:log:write")
    expect(logCall?.[1]).toEqual(expect.objectContaining({
      level: "error",
      category: "renderer.ipc",
      message: "IPC invoke failed.",
      details: expect.objectContaining({
        channel: "synapse:config:get",
        error: expect.any(String),
      }),
    }))

    const serializedLog = JSON.stringify(logCall?.[1])
    expect(serializedLog).not.toContain("sk-secret")
    expect(serializedLog).not.toContain("abc.def")
    expect(serializedLog).not.toContain("/Users/liyang/private")
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
