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

  it("starts idle reclaim at most once", async () => {
    const closeIdleSessions = vi.fn(async () => {})
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository: {} as AgentSessionRepository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: { closeIdleSessions } as unknown as SessionManager,
      getActiveAgentType: async () => "claude-sdk",
    })

    manager.startIdleReclaim()
    manager.startIdleReclaim()
    await vi.advanceTimersByTimeAsync(60_000)
    manager.stopIdleReclaim()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(closeIdleSessions).toHaveBeenCalledOnce()
  })

  it("closes runtime state before deleting persisted session data", async () => {
    const calls: string[] = []
    const repository = {
      get: vi.fn(async () => ({ id: "conversation-1", sessionKey: "session-1" })),
      deleteSession: vi.fn(async () => {
        calls.push("delete")
      }),
    } as unknown as AgentSessionRepository
    const closeState = vi.fn(async () => {
      calls.push("close")
    })
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: { closeState } as unknown as SessionManager,
      getActiveAgentType: async () => "claude-sdk",
    })

    await expect(manager.deleteSession("conversation-1")).resolves.toBe(true)

    expect(closeState).toHaveBeenCalledWith("conversation-1")
    expect(calls).toEqual(["close", "delete"])
  })

  it("keeps persisted session data when closing runtime state fails", async () => {
    const repository = {
      get: vi.fn(async () => ({ id: "conversation-1", sessionKey: "session-1" })),
      deleteSession: vi.fn(async () => {}),
    } as unknown as AgentSessionRepository
    const closeState = vi.fn(async () => {
      throw new Error("close failed")
    })
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: { closeState } as unknown as SessionManager,
      getActiveAgentType: async () => "claude-sdk",
    })

    await expect(manager.deleteSession("conversation-1")).rejects.toThrow("close failed")

    expect(closeState).toHaveBeenCalledWith("conversation-1")
    expect(repository.deleteSession).not.toHaveBeenCalled()
  })

  it("logs reset session outcomes with SDK resume correlation metadata", async () => {
    const logger = structuredLogger()
    const conversation = {
      id: "conversation-1",
      sessionKey: "session-1",
      platform: "local-renderer",
      workspaceKey: "workspace-1",
    }
    const repository = {
      getActive: vi.fn(async () => conversation),
      clearCurrentAgentSessionId: vi.fn(async () => ({ ...conversation, sdkSessionId: undefined })),
    } as unknown as AgentSessionRepository
    const closeState = vi.fn(async () => {})
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: { closeState } as unknown as SessionManager,
      logger,
      getActiveAgentType: async () => "claude-sdk",
    })

    await manager.resetSession("session-1", "local-renderer", "workspace-1")

    expect(closeState).toHaveBeenCalledWith("conversation-1")
    expect(logger.info).toHaveBeenCalledWith("Agent session reset.", {
      projectId: "project-1",
      boundary: "agent-runtime.session.reset",
      sessionKey: "session-1",
      platform: "local-renderer",
      workspaceKey: "workspace-1",
      conversationId: "conversation-1",
      agentType: "claude-sdk",
      hadConversation: true,
    })
  })

  it("passes the fixed persona snapshot into session creation", async () => {
    const updated = { id: "conversation-1", sessionKey: "session-1" }
    const repository = {
      createSession: vi.fn(async () => updated),
    } as unknown as AgentSessionRepository
    const manager = new SessionLifecycleManager({
      projectId: "project-1",
      repository,
      states: new Map(),
      pendingPermissions: new Map(),
      sessionManager: {} as SessionManager,
      getActiveAgentType: async () => "claude-sdk",
    })
    const snapshot = {
      id: "builtin-zh-en-translator",
      name: "中英翻译",
      source: "builtin" as const,
      definitionHash: "hash-translator",
    }

    await expect(manager.createSession({
      sessionKey: "session-1",
      providerId: "anthropic",
      modelTier: "sonnet",
      mainThreadPersonaSnapshot: snapshot,
    })).resolves.toBe(updated)

    expect(repository.createSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: "session-1",
      providerId: "anthropic",
      modelTier: "sonnet",
      mainThreadPersonaSnapshot: snapshot,
    }))
  })
})

function structuredLogger(): StructuredLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
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
