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
    const result = await handler?.({ senderFrame: { url: "http://localhost:5173/" } }, {
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
    })

    expect(result).toMatchObject({
      __synapseIpcError: true,
      message: "SDK failed for secret prompt text token=[redacted]",
      name: "Error",
    })

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
    const result = await handler?.({ senderFrame: { url: "http://localhost:5173/" } }, {
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
    })

    expect(result).toMatchObject({
      __synapseIpcError: true,
      message: "Local drive upload pipeline is unavailable.",
      name: "Error",
    })

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

  it("returns sanitized user-facing failure envelopes without logging secrets", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { createElectronTransportInstall } = await import("../electron-adapter")
    const install = createElectronTransportInstall({ logger })
    const error = new Error([
      "Authentication failed for https://token:secret@github.com/team/docs.git?token=raw-token",
      "Authorization: Basic dXNlcjpzZWNyZXQ=",
      "Authorization=Basic ZXF1YWxzOnNlY3JldA==",
      "Authorization: Bearer raw.bearer.payload",
      "Authorization=Bearer raw.equals.bearer",
      "Cookie: sid=raw-cookie; session=secret-cookie",
      "Cookie=sid=equals-cookie; session=equals-secret",
      "cwd: /Users/alice/work/docs",
    ].join("\n"))
    Object.defineProperty(error, "userFacingFailure", {
      enumerable: false,
      value: {
        category: "github-auth",
        detail: "fatal: Authorization=Basic detail-basic\nCookie: sid=detail-cookie; session=detail-secret\ncwd: /Users/alice/work/docs",
        extra: "extra-secret",
        host: "github.com",
        message: "请处理 GitHub 访问 token=message-token",
        primaryAction: "handle-github-auth",
        protocol: "https",
        title: "GitHub 需要登录 Authorization: Bearer title-token",
        token: "failure-token",
        cookie: "failure-cookie",
        authorization: "Bearer failure-auth",
      },
    })

    install("synapse:git:repositories:clone", async () => {
      throw error
    })

    const handler = electronMock.handlers.get("synapse:git:repositories:clone")
    const result = await handler?.({ senderFrame: { url: "http://localhost:5173/" } }, {
      remoteUrl: "https://token:secret@github.com/team/docs.git?token=raw-token",
      targetPath: "/Users/alice/Secrets/docs",
      name: "docs",
    })

    expect(result).toMatchObject({
      __synapseIpcError: true,
      name: "Error",
      message: expect.stringContaining("https://[redacted]@github.com/team/docs.git?token=[redacted]"),
      userFacingFailure: {
        category: "github-auth",
        detail: expect.stringContaining("fatal: Authorization=Basic [redacted]"),
        host: "github.com",
        message: "请处理 GitHub 访问 token=[redacted]",
        primaryAction: "handle-github-auth",
        protocol: "https",
        title: "GitHub 需要登录 Authorization: Bearer [redacted]",
      },
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Authorization: Basic [redacted]"),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Authorization=Basic [redacted]"),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Authorization: Bearer [redacted]"),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Authorization=Bearer [redacted]"),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Cookie: [redacted]"),
    })
    expect(result).toMatchObject({
      message: expect.stringContaining("Cookie=[redacted]"),
    })
    const serializedResult = JSON.stringify(result)
    expect(serializedResult).not.toContain("token:secret")
    expect(serializedResult).not.toContain("raw-token")
    expect(serializedResult).not.toContain("dXNlcjpzZWNyZXQ=")
    expect(serializedResult).not.toContain("ZXF1YWxzOnNlY3JldA==")
    expect(serializedResult).not.toContain("raw.bearer.payload")
    expect(serializedResult).not.toContain("raw.equals.bearer")
    expect(serializedResult).not.toContain("raw-cookie")
    expect(serializedResult).not.toContain("secret-cookie")
    expect(serializedResult).not.toContain("equals-cookie")
    expect(serializedResult).not.toContain("equals-secret")
    expect(serializedResult).not.toContain("detail-basic")
    expect(serializedResult).not.toContain("detail-cookie")
    expect(serializedResult).not.toContain("detail-secret")
    expect(serializedResult).not.toContain("message-token")
    expect(serializedResult).not.toContain("title-token")
    expect(serializedResult).not.toContain("failure-token")
    expect(serializedResult).not.toContain("failure-cookie")
    expect(serializedResult).not.toContain("failure-auth")
    expect(serializedResult).not.toContain("extra-secret")
    expect(serializedResult).not.toContain("\"extra\"")
    expect(serializedResult).not.toContain("\"token\"")
    expect(serializedResult).not.toContain("\"cookie\"")
    expect(serializedResult).not.toContain("\"authorization\"")
    expect(serializedResult).toContain("Cookie: [redacted]")
    expect(serializedResult).toContain("/Users/alice/work/docs")

    const serializedLog = JSON.stringify(logger.error.mock.calls)
    expect(serializedLog).not.toContain("token:secret")
    expect(serializedLog).not.toContain("raw-token")
    expect(serializedLog).not.toContain("/Users/alice")
  })

})
