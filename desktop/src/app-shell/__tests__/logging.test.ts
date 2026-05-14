/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const { logWrite } = vi.hoisted(() => ({
  logWrite: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    log: {
      write: logWrite,
    },
  }),
}))

vi.mock("@/lib/diagnostic-context", () => ({
  getDiagnosticSnapshot: () => ({
    recentActions: [],
  }),
}))

import { createRendererLogger, installRendererLogForwarding } from "../logging"

afterEach(() => {
  logWrite.mockReset()
})

describe("renderer logging", () => {
  it("sanitizes Agent renderer log details before writing through the bridge", () => {
    const logger = createRendererLogger("agent")

    logger.error("Agent send failed.", {
      boundary: "renderer.agent.send",
      conversationId: "conversation-1",
      prompt: "secret prompt body",
      authorization: "Bearer raw-token",
      nested: {
        cookie: "session=raw",
        message: "token=sk-secret from SDK",
      },
      error: new Error("SDK failed with token=sk-secret and prompt text"),
    })

    expect(logWrite).toHaveBeenCalledWith({
      level: "error",
      category: "agent",
      message: "Agent send failed.",
      details: expect.objectContaining({
        boundary: "renderer.agent.send",
        conversationId: "conversation-1",
        promptLength: 18,
        authorization: "[redacted]",
        nested: expect.objectContaining({
          cookie: "[redacted]",
          messageLength: 24,
        }),
        error: expect.objectContaining({
          errorName: "Error",
          messageLength: 47,
        }),
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("secret prompt body")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("Bearer raw-token")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("sk-secret")
  })

  it("sanitizes unhandled rejection reasons before writing renderer diagnostics", () => {
    const uninstall = installRendererLogForwarding()
    const reason = new Error("failed with authorization=Bearer raw-token and prompt text")

    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.reject(reason).catch(() => undefined),
      reason,
    }))

    uninstall()

    expect(logWrite).toHaveBeenCalledWith({
      level: "error",
      category: "renderer.runtime",
      message: "Unhandled promise rejection in renderer.",
      details: expect.objectContaining({
        reason: expect.objectContaining({
          errorName: "Error",
          messageLength: 58,
        }),
        diagnostics: {
          recentActions: [],
        },
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("Bearer raw-token")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("prompt text")
  })
})
