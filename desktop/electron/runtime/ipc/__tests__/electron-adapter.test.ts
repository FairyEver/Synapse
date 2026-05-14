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
    const error = new Error("SDK failed for secret prompt text token=sk-live")
    error.stack = [
      "Error: SDK failed for secret prompt text token=sk-live",
      "    at send (/Users/liyang/project/agent.ts:1:1)",
    ].join("\n")

    install("synapse:test:fail", async () => {
      throw error
    })

    const handler = electronMock.handlers.get("synapse:test:fail")
    await expect(handler?.({}, {
      token: "secret",
      value: "ok",
      content: "deploy private branch with customer secret",
      prompt: "summarize private customer outage",
      metadata: {
        message: "approval says include customer names",
      },
    })).rejects.toThrow(
      "SDK failed for secret prompt text token=sk-live",
    )

    expect(logger.error).toHaveBeenCalledWith(
      "IPC invoke failed.",
      expect.objectContaining({
        channel: "synapse:test:fail",
        durationMs: expect.any(Number),
        error: expect.objectContaining({
          name: "Error",
          messageLength: "SDK failed for secret prompt text token=sk-live".length,
          stack: expect.stringContaining("[redacted message"),
        }),
        request: expect.objectContaining({
          token: "[redacted]",
          value: "ok",
          content: "[redacted text 42 chars]",
          prompt: "[redacted text 33 chars]",
          metadata: expect.objectContaining({
            message: "[redacted text 36 chars]",
          }),
        }),
      }),
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret prompt text")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("deploy private branch")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private customer outage")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("customer names")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sk-live")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/Users/liyang")
  })
})
