import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  OutboxEntryV1,
} from "../../../runtime/data-repo"
import { ReplyOutboxService } from "../outbox-service"

describe("ReplyOutboxService", () => {
  it("records pending local renderer events before dispatch completes", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      idFactory: () => "outbox-1",
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })

    await service.recordAgentEvent({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conv-1",
      transport: { kind: "local-renderer" },
    }, {
      type: "result",
      content: "done",
      done: true,
      agentSessionId: "thread-1",
      threadId: "thread-1",
    })
    await service.flushForTests()

    expect(await outbox.list()).toEqual([
      expect.objectContaining({
        id: "outbox-1",
        projectId: "project-1",
        destination: expect.objectContaining({
          platform: "local-renderer",
          sessionKey: "local:renderer",
        }),
        payload: {
          kind: "text",
          content: "done",
          metadata: {
            eventType: "result",
            agentSessionId: "thread-1",
            threadId: "thread-1",
          },
        },
        attempts: 0,
        status: "pending",
      }),
    ])
  })

  it("records failed events with bounded error summaries", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      idFactory: () => "outbox-2",
    })
    const rawError = "Authorization: Bearer sk-secret-token failed at /Users/example/private prompt fragment"

    await service.recordAgentEvent({
      projectId: "project-1",
      sessionKey: "local:renderer",
      transport: { kind: "local-renderer" },
    }, {
      type: "error",
      message: rawError,
    })
    await service.flushForTests()

    expect((await outbox.list())[0]).toEqual(expect.objectContaining({
      id: "outbox-2",
      status: "failed",
      lastError: `Error (${rawError.length} chars)`,
      payload: expect.objectContaining({
        kind: "event",
        content: `Error (${rawError.length} chars)`,
      }),
    }))
    expect(JSON.stringify(await outbox.list())).not.toContain("sk-secret-token")
    expect(JSON.stringify(await outbox.list())).not.toContain("/Users/example")
    expect(JSON.stringify(await outbox.list())).not.toContain("private prompt")
  })

  it("stores bounded dispatch failure summaries in lastError", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      idFactory: () => "outbox-5",
    })
    const rawError = "bridge failed token=sk-dispatch-secret at /Users/example/repo"

    const id = await service.record({
      target: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        transport: { kind: "local-renderer" },
      },
      payload: { kind: "text", content: "done", metadata: {} },
      status: "pending",
    })
    await service.updateRecordStatus(id, "failed", rawError)
    await service.flushForTests()

    expect((await outbox.list())[0]).toEqual(expect.objectContaining({
      status: "failed",
      lastError: `Error (${rawError.length} chars)`,
    }))
    expect(JSON.stringify(await outbox.list())).not.toContain("sk-dispatch-secret")
    expect(JSON.stringify(await outbox.list())).not.toContain("/Users/example")
  })

  it("prunes old sent entries for the same reply target", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const listSpy = vi.spyOn(outbox, "list")
    let nextId = 0
    let clock = Date.parse("2026-04-26T00:00:00.000Z")
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      idFactory: () => `outbox-${nextId++}`,
      now: () => {
        clock += 1000
        return new Date(clock)
      },
      sentRetentionLimit: 2,
    })
    const target = {
      projectId: "project-1",
      sessionKey: "local:renderer",
      transport: { kind: "local-renderer" },
    }
    await service.record({
      target,
      payload: { kind: "text", content: "pending", metadata: {} },
      status: "pending",
    })
    await service.record({
      target,
      payload: { kind: "text", content: "failed", metadata: {} },
      status: "failed",
      lastError: "failed",
    })

    for (let index = 0; index < 4; index += 1) {
      const id = await service.record({
        target,
        payload: { kind: "text", content: `sent-${index}`, metadata: {} },
        status: "pending",
      })
      await service.updateRecordStatus(id, "sent")
    }
    await service.flushForTests()

    expect(listSpy).toHaveBeenCalledOnce()
    expect((await outbox.list()).map((entry) => entry.id).sort()).toEqual([
      "outbox-0",
      "outbox-1",
      "outbox-4",
      "outbox-5",
    ])
  })

  it("records Agent event correlation metadata for diagnostics", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      idFactory: () => "outbox-3",
    })

    await service.recordAgentEvent({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conv-1",
      transport: { kind: "local-renderer" },
    }, {
      type: "result",
      content: "done",
      done: true,
      agentSessionId: "thread-1",
      threadId: "thread-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      providerId: "claude-code",
      projectId: "project-1",
      sdkSessionId: "sdk-1",
    })
    await service.flushForTests()

    expect((await outbox.list())[0]?.payload.metadata).toEqual(expect.objectContaining({
      eventType: "result",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      providerId: "claude-code",
      projectId: "project-1",
      sdkSessionId: "sdk-1",
    }))
  })

  it("applies sent retention to rows created by an earlier service instance", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const target = {
      projectId: "project-1",
      sessionKey: "external:chat",
      transport: { kind: "external" },
    }
    for (let index = 0; index < 4; index += 1) {
      const timestamp = new Date(Date.parse("2026-04-26T00:00:00.000Z") + index * 1000).toISOString()
      await outbox.upsert({
        id: `legacy-${index}`,
        schemaVersion: 1,
        projectId: "project-1",
        destination: {
          platform: "external",
          sessionKey: "external:chat",
        },
        payload: { kind: "text", content: `legacy-${index}` },
        attempts: 1,
        status: "sent",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      sentRetentionLimit: 2,
      idFactory: () => "current",
      now: () => new Date("2026-04-26T00:01:00.000Z"),
    })

    await service.record({
      target,
      payload: { kind: "text", content: "current" },
      status: "sent",
    })

    expect((await outbox.list()).map((entry) => entry.id).sort()).toEqual([
      "current",
      "legacy-3",
    ])
  })

  it("logs outbox persistence failures without raw error text", async () => {
    const logger = { warn: vi.fn() }
    const service = new ReplyOutboxService({
      projectId: "project-1",
      outbox: new FailingNamespace<OutboxEntryV1>(
        "outbox",
        new Error("SDK failed for secret prompt at /Users/liyang/token.txt"),
      ),
      logger,
      idFactory: () => "outbox-4",
    })

    await expect(service.recordAgentEvent({
      projectId: "project-1",
      sessionKey: "local:renderer",
      transport: { kind: "local-renderer" },
    }, {
      type: "result",
      content: "done",
      done: true,
    })).rejects.toThrow("SDK failed for secret prompt at /Users/liyang/token.txt")
    await service.flushForTests()

    expect(logger.warn).toHaveBeenCalledWith(
      "Outbox persistence failed.",
      expect.objectContaining({
        projectId: "project-1",
        hasSessionKey: true,
        errorName: "Error",
        errorLength: "SDK failed for secret prompt at /Users/liyang/token.txt".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/liyang")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("token.txt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("local:renderer")
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "sqlite" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((value) =>
      Object.entries(filter).every(([key, expected]) =>
        (value as Record<string, unknown>)[key] === expected,
      ),
    )
  }

  async listWindow(options: Parameters<NonNullable<DataNamespace<T>["listWindow"]>>[0]) {
    const values = await this.list(options.filter as Partial<T>)
    const orderKeys: Array<keyof T> = Array.isArray(options.orderBy)
      ? [...options.orderBy]
      : [options.orderBy ?? "updatedAt" as keyof T]
    const direction = options.order === "asc" ? 1 : -1
    values.sort((left, right) => {
      for (const key of orderKeys) {
        const compared = String(left[key] ?? "").localeCompare(String(right[key] ?? ""))
        if (compared !== 0) return compared * direction
      }
      return 0
    })
    const offset = options.offset ?? 0
    return values.slice(offset, offset + options.limit).map((value) => ({ value }))
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

class FailingNamespace<T extends { id: string }> extends MemoryNamespace<T> {
  constructor(name: string, private readonly error: Error) {
    super(name)
  }

  override async upsert(): Promise<void> {
    throw this.error
  }
}
