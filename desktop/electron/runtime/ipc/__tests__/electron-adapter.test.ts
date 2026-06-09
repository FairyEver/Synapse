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
    process.env.VITE_DEV_SERVER_URL = "http://localhost:5173"
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
    await expect(handler?.({ senderFrame: { url: "http://localhost:5173/" } }, {
      token: "secret",
      value: "ok",
      body: "raw HTTP body with bearer sample",
      content: "deploy private branch with customer secret",
      prompt: "summarize private customer outage",
      requestBody: "request body with customer data",
      responseBody: "response body with customer data",
      text: "freeform text with customer data",
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
          body: "[redacted text 32 chars]",
          content: "[redacted text 42 chars]",
          prompt: "[redacted text 33 chars]",
          requestBody: "[redacted text 31 chars]",
          responseBody: "[redacted text 32 chars]",
          text: "[redacted text 32 chars]",
          metadata: expect.objectContaining({
            message: "[redacted text 36 chars]",
          }),
        }),
      }),
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret prompt text")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("deploy private branch")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private customer outage")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("customer data")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("raw HTTP body")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("customer names")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sk-live")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/Users/liyang")
  })

  it("redacts local path-like fields from failed IPC invoke request logs", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { createElectronTransportInstall } = await import("../electron-adapter")
    const install = createElectronTransportInstall({ logger })

    install("synapse:account:drive:uploads:local-items", async () => {
      throw new Error("Local drive upload pipeline is unavailable.")
    })

    const handler = electronMock.handlers.get("synapse:account:drive:uploads:local-items")
    await expect(handler?.({ senderFrame: { url: "http://localhost:5173/" } }, {
      parentId: "folder-1",
      items: [
        {
          kind: "file",
          path: "/Users/alice/Secrets/report.txt",
          name: "report.txt",
          mimeType: "text/plain",
        },
        {
          kind: "folder",
          folderName: "Secrets",
          files: [
            {
              path: "/Users/alice/Secrets/nested/report.txt",
              relativePath: "nested/report.txt",
              mimeType: "text/plain",
            },
          ],
        },
      ],
      itemPaths: ["/Users/alice/Secrets/report.txt"],
    })).rejects.toThrow("Local drive upload pipeline is unavailable.")

    expect(logger.error).toHaveBeenCalledWith(
      "IPC invoke failed.",
      expect.objectContaining({
        channel: "synapse:account:drive:uploads:local-items",
        request: expect.objectContaining({
          parentId: "folder-1",
          items: expect.any(Array),
          itemPaths: expect.any(Array),
        }),
      }),
    )

    const serializedLog = JSON.stringify(logger.error.mock.calls)
    expect(serializedLog).not.toContain("/Users/alice/Secrets/report.txt")
    expect(serializedLog).not.toContain("/Users/alice/Secrets")
    expect(serializedLog).not.toContain("nested/report.txt")
    expect(serializedLog).not.toContain("report.txt")
    expect(serializedLog).not.toContain("Secrets")
  })
})
