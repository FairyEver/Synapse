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

  it("redacts install session IDs before writing renderer logs", () => {
    const logger = createRendererLogger("skill-repository-install.window")

    logger.error("Failed to prepare Skill Repository install.", {
      sessionId: "install-session-secret",
      installSessionId: "install-session-secret-2",
      skillRepositoryInstallSessionId: "install-session-secret-3",
      nested: {
        session_id: "install-session-secret-4",
      },
    })

    expect(logWrite).toHaveBeenCalledWith({
      level: "error",
      category: "skill-repository-install.window",
      message: "Failed to prepare Skill Repository install.",
      details: expect.objectContaining({
        sessionId: "[redacted]",
        installSessionId: "[redacted]",
        skillRepositoryInstallSessionId: "[redacted]",
        nested: {
          session_id: "[redacted]",
        },
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("install-session-secret")
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

  it("summarizes string error fields before writing renderer logs", () => {
    const logger = createRendererLogger("workflow.run")

    logger.error("Workflow run failed.", {
      boundary: "renderer.workflow.run.start",
      workflowId: "workflow-1",
      error: "SDK failed with token=sk-secret and prompt text",
    })

    expect(logWrite).toHaveBeenCalledWith({
      level: "error",
      category: "workflow.run",
      message: "Workflow run failed.",
      details: expect.objectContaining({
        boundary: "renderer.workflow.run.start",
        workflowId: "workflow-1",
        errorLength: 47,
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("prompt text")
  })

  it("summarizes string errors arrays before writing renderer logs", () => {
    const logger = createRendererLogger("workflow.runner")

    logger.warn("rerun failed", {
      runId: "run-1",
      errors: [
        "SDK failed with token=sk-secret and prompt text",
        "failed at /Users/liyang/private/repo/workflow.json",
      ],
    })

    expect(logWrite).toHaveBeenCalledWith({
      level: "warn",
      category: "workflow.runner",
      message: "rerun failed",
      details: expect.objectContaining({
        runId: "run-1",
        errors: [
          { errorsLength: 47 },
          { errorsLength: 50 },
        ],
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("prompt text")
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("/Users/liyang/private")
  })

  it("redacts path-like fields before writing renderer logs", () => {
    const logger = createRendererLogger("renderer.runtime")

    logger.error("Renderer error event.", {
      filename: "/Users/liyang/private/repo/dist/renderer.js",
      workspacePath: "/Users/liyang/private/repo",
      profile: "default",
      boundary: "renderer.runtime.error",
    })

    expect(logWrite).toHaveBeenCalledWith({
      level: "error",
      category: "renderer.runtime",
      message: "Renderer error event.",
      details: expect.objectContaining({
        filename: "[path redacted]/renderer.js",
        workspacePath: "[path redacted]/repo",
        profile: "default",
        boundary: "renderer.runtime.error",
      }),
    })
    expect(JSON.stringify(logWrite.mock.calls)).not.toContain("/Users/liyang/private")
  })

  it("does not write raw bridge failures to console when renderer log forwarding fails", async () => {
    const rawError = "log bridge failed with token=sk-secret and prompt text"
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    logWrite.mockImplementationOnce(() => {
      throw new Error(rawError)
    })
    const logger = createRendererLogger("agent")

    try {
      logger.error("Agent send failed.", {
        boundary: "renderer.agent.send",
        prompt: "secret prompt body",
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(consoleError).not.toHaveBeenCalled()
      expect(consoleWarn).not.toHaveBeenCalled()
      expect(logWrite).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
      consoleWarn.mockRestore()
    }
  })

  it("swallows asynchronous IPC write failures without recursively logging", async () => {
    logWrite.mockRejectedValueOnce(new Error("IPC unavailable"))
    const logger = createRendererLogger("ui.tracking")

    expect(() => logger.info("button.click", { telemetry: { eventKey: "button.click" } })).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(logWrite).toHaveBeenCalledTimes(1)
  })
})
