import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, request: unknown) => Promise<unknown>>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, request: unknown) => Promise<unknown>) => {
      electronMock.handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      electronMock.handlers.delete(channel)
    }),
  },
}))

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
}))

describe("createElectronTransportInstall", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.ipcMain.handle.mockClear()
    electronMock.ipcMain.removeHandler.mockClear()
  })

  it("logs failed IPC invokes with channel and elapsed time", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { createElectronTransportInstall } = await import("../electron-adapter")
    const install = createElectronTransportInstall({ logger })
    const error = new Error("boom")

    install("synapse:test:fail", async () => {
      throw error
    })

    const handler = electronMock.handlers.get("synapse:test:fail")
    await expect(handler?.({}, { token: "secret", value: "ok" })).rejects.toThrow("boom")

    expect(logger.error).toHaveBeenCalledWith(
      "IPC invoke failed.",
      expect.objectContaining({
        channel: "synapse:test:fail",
        durationMs: expect.any(Number),
        error,
        request: expect.objectContaining({
          token: "[redacted]",
          value: "ok",
        }),
      }),
    )
  })
})
