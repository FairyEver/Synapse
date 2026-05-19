import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  RelayBindingEntryV1,
  RelayRunEntryV1,
} from "../../../runtime/data-repo"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { InMemoryAuditSink } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type { AgentRuntimeService } from "../../agent-runtime"
import { AgentRelayService } from "../agent-relay-service"

describe("AgentRelayService", () => {
  it("logs relay Agent runtime failures with correlation context without persisting raw error text", async () => {
    const runs = new MemoryNamespace<RelayRunEntryV1>("relay.runs")
    const auditSink = new InMemoryAuditSink()
    const logger = fakeLogger()
    const service = new AgentRelayService({
      projectContainers: fakeProjectContainers(failingAgent("relay failed with secret prompt body")),
      bindings: new MemoryNamespace<RelayBindingEntryV1>("relay.bindings"),
      runs,
      listProjects: async () => [
        { projectId: "source", name: "Source" },
        { projectId: "target", name: "Target" },
      ],
      auditSink,
      logger,
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    })

    await expect(service.send({
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
      message: "user prompt body",
    })).rejects.toThrow("relay failed with secret prompt body")

    const run = (await runs.list())[0]
    expect(run).toMatchObject({
      status: "failed",
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
      targetSessionKey: "relay:source:bridge:s1",
      lastError: "Error (36 chars)",
    })
    expect(logger.warn).toHaveBeenCalledWith("Agent relay runtime failed.", {
      boundary: "agent-relay.agent-runtime",
      runId: run?.id,
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
      targetSessionKey: "relay:source:bridge:s1",
      errorName: "Error",
      errorLength: 36,
    })
    expect(auditSink.list()[0]?.metadata).toMatchObject({
      error: "Error (36 chars)",
      runId: run?.id,
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
    })
    expect(JSON.stringify({ run, audit: auditSink.list(), logs: logger.warn.mock.calls }))
      .not.toContain("secret prompt body")
    expect(JSON.stringify({ run, audit: auditSink.list(), logs: logger.warn.mock.calls }))
      .not.toContain("user prompt body")
  })

  it("logs relay Agent runtime error results with correlation context", async () => {
    const runs = new MemoryNamespace<RelayRunEntryV1>("relay.runs")
    const logger = fakeLogger()
    const service = new AgentRelayService({
      projectContainers: fakeProjectContainers(errorResultAgent("sdk error with secret prompt body")),
      bindings: new MemoryNamespace<RelayBindingEntryV1>("relay.bindings"),
      runs,
      listProjects: async () => [
        { projectId: "source", name: "Source" },
        { projectId: "target", name: "Target" },
      ],
      logger,
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    })

    const result = await service.send({
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
      message: "user prompt body",
    })

    const run = (await runs.list())[0]
    expect(result).toMatchObject({
      runId: run?.id,
      error: "string (33 chars)",
      targetSessionKey: "relay:source:bridge:s1",
    })
    expect(run).toMatchObject({
      status: "failed",
      lastError: "string (33 chars)",
    })
    expect(logger.warn).toHaveBeenCalledWith("Agent relay runtime failed.", {
      boundary: "agent-relay.agent-runtime",
      runId: run?.id,
      sourceProjectId: "source",
      sourceSessionKey: "bridge:s1",
      targetProjectId: "target",
      targetSessionKey: "relay:source:bridge:s1",
      errorName: "string",
      errorLength: 33,
    })
    expect(JSON.stringify({ result, run, logs: logger.warn.mock.calls })).not.toContain("secret prompt body")
    expect(JSON.stringify({ result, run, logs: logger.warn.mock.calls })).not.toContain("user prompt body")
  })
})

class MemoryNamespace<T extends { readonly id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly rows = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(_value: T): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const rows = [...this.rows.values()]
    if (!filter) return rows
    return rows.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key as keyof T] === value))
  }

  async get(id: string): Promise<T | null> {
    return this.rows.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.rows.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id)
  }

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => {}
  }
}

function fakeProjectContainers(agent: Pick<AgentRuntimeService, "sendSideSessionWithTimeout">): ProjectContainerRegistry {
  return {
    open: async (projectId) => ({
      projectId,
      get: () => agent,
      inspect: () => [],
      dispose: async () => {},
    }) as ProjectContainer,
    peek: () => undefined,
    close: async () => {},
    list: () => [],
    registerService: () => {},
    setQuota: () => {},
  }
}

function failingAgent(message: string): Pick<AgentRuntimeService, "sendSideSessionWithTimeout"> {
  return {
    sendSideSessionWithTimeout: async () => {
      throw new Error(message)
    },
  }
}

function successAgent(resultText: string): Pick<AgentRuntimeService, "sendSideSessionWithTimeout"> {
  return {
    sendSideSessionWithTimeout: async () => ({
      conversationId: "conversation-relay-1",
      events: [],
      resultText,
      partialText: undefined,
      timedOut: false,
    }),
  }
}

function errorResultAgent(message: string): Pick<AgentRuntimeService, "sendSideSessionWithTimeout"> {
  return {
    sendSideSessionWithTimeout: async () => ({
      conversationId: "conversation-relay-1",
      events: [],
      resultText: "",
      partialText: undefined,
      timedOut: false,
      error: message,
    }),
  }
}

function fakeLogger(): StructuredLogger & { warn: ReturnType<typeof vi.fn> } {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } satisfies Omit<StructuredLogger, "child"> & { child: ReturnType<typeof vi.fn> }
  logger.child.mockReturnValue(logger)
  return logger as StructuredLogger & { warn: ReturnType<typeof vi.fn> }
}
