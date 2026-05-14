import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StructuredLogger } from "../../../runtime/service-registry"
import type { AgentSessionRepository } from "../session-repository"
import { SessionLifecycleManager } from "../session-lifecycle"
import type { SessionManager } from "../session-manager"

describe("SessionLifecycleManager", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("logs timer-driven idle reclaim failures without leaking error text", async () => {
    const logger = structuredLogger()
    const closeIdleSessions = vi.fn(async () => {
      throw new Error("SDK close failed for secret prompt")
    })
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository: {} as AgentSessionRepository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: { closeIdleSessions } as unknown as SessionManager,
      logger,
      getActiveAgentType: async () => "claude-sdk",
    })

    manager.startIdleReclaim()
    await vi.advanceTimersByTimeAsync(60_000)
    manager.stopIdleReclaim()

    expect(closeIdleSessions).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith("Agent idle reclaim failed.", {
      projectId: "project-1",
      boundary: "agent-runtime-idle-reclaim",
      errorName: "Error",
      errorLength: "SDK close failed for secret prompt".length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
  })
})

function structuredLogger(): StructuredLogger & { warn: ReturnType<typeof vi.fn> } {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
}
