import { Buffer } from "node:buffer"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  DataRepository,
  OutboxEntryV1,
} from "../../../runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../runtime/network"
import { createPermissionGuard, InMemoryAuditSink } from "../../../runtime/security"
import type { ReplyTarget } from "../../reply-target"
import {
  AttachmentPolicyError,
  prepareSideChannelAttachments,
  SideChannelService,
  sanitizeAttachmentFileName,
  type ReplyTransportDispatcher,
} from "../index"
import type { StructuredLogger } from "../../../runtime/service-registry"

describe("SideChannelService", () => {
  it("sends text to the remembered reply target through a generic dispatcher", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(outbox),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      auditSink: new InMemoryAuditSink(),
      token: "tok",
    })
    await service.start()
    const env = service.getAgentEnv("project-1", "bridge:s1")
    expect(env).toEqual(expect.objectContaining({
      CC_PROJECT: "project-1",
      CC_SESSION_KEY: "bridge:s1",
      SYNAPSE_SIDE_CHANNEL_TOKEN: "tok",
    }))

    const dispatcher = new FakeDispatcher()
    service.registerDispatcher("bridge", dispatcher)
    service.rememberReplyTarget(bridgeTarget())

    const response = await fetch(env?.SYNAPSE_SIDE_CHANNEL_URL ?? "", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env?.SYNAPSE_SIDE_CHANNEL_TOKEN ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: "project-1",
        sessionKey: "bridge:s1",
        message: "generated file is ready",
      }),
    })

    expect(response.status).toBe(200)
    expect(dispatcher.sideChannelPayloads).toEqual([
      {
        target: bridgeTarget(),
        message: "generated file is ready",
        attachmentCount: 0,
      },
    ])
    await expectEventually(async () => (await outbox.list()).length, 1)
    expect(await outbox.list()).toEqual([
      expect.objectContaining({
        status: "sent",
        destination: expect.objectContaining({
          platform: "bridge",
          connectorId: "bridge",
          sessionKey: "bridge:s1",
        }),
        payload: expect.objectContaining({
          kind: "text",
          content: "generated file is ready",
        }),
      }),
    ])
    await service.stop()
  })

  it("records muted side-channel sends without dispatching externally", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const auditSink = new InMemoryAuditSink()
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(outbox),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      auditSink,
      token: "tok",
    })
    const dispatcher = new FakeDispatcher()
    service.registerDispatcher("bridge", dispatcher)
    service.rememberReplyTarget({
      ...bridgeTarget(),
      replyCtx: { ...bridgeTarget().replyCtx, muted: true },
    })

    const result = await service.send({
      project: "project-1",
      sessionKey: "bridge:s1",
      message: "generated file is ready",
    })

    expect(result).toEqual({
      ok: true,
      projectId: "project-1",
      sessionKey: "bridge:s1",
      outboxRecorded: true,
    })
    expect(dispatcher.sideChannelPayloads).toEqual([])
    await expectEventually(async () => (await outbox.list()).length, 1)
    expect(await outbox.list()).toEqual([
      expect.objectContaining({
        status: "sent",
        destination: expect.objectContaining({
          platform: "bridge",
          connectorId: "bridge",
          sessionKey: "bridge:s1",
        }),
        payload: expect.objectContaining({
          kind: "text",
          content: "generated file is ready",
        }),
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "network.connect",
        outcome: "allowed",
        resource: "side-channel:/send",
        metadata: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "bridge:s1",
          transportKind: "bridge",
          connectorId: "bridge",
          attachmentCount: 0,
        }),
      }),
    ])
  })

  it("sanitizes failed side-channel send dispatch diagnostics", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const auditSink = new InMemoryAuditSink()
    const warn = vi.fn()
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(outbox),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      auditSink,
      logger: fakeLogger({ warn }),
      token: "tok",
    })
    service.registerDispatcher("bridge", {
      dispatchAgentEvent: async () => {},
      dispatchSideChannelSend: async () => {
        throw new Error("bridge failed with secret prompt text")
      },
    })
    service.rememberReplyTarget(bridgeTarget())

    await expect(service.send({
      project: "project-1",
      sessionKey: "bridge:s1",
      message: "generated file is ready",
    })).rejects.toThrow("dispatch failed")

    const outboxEntries = await outbox.list()
    expect(outboxEntries).toEqual([
      expect.objectContaining({
        status: "failed",
        lastError: "dispatch failed",
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        metadata: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "bridge:s1",
          transportKind: "bridge",
          connectorId: "bridge",
          attachmentCount: 0,
          errorName: "Error",
          errorLength: "bridge failed with secret prompt text".length,
        }),
      }),
    ])
    expect(warn).toHaveBeenCalledWith("Side-channel send dispatch failed.", expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      transportKind: "bridge",
      connectorId: "bridge",
      attachmentCount: 0,
      errorName: "Error",
      errorLength: "bridge failed with secret prompt text".length,
    }))
    expect(JSON.stringify(outboxEntries)).not.toContain("secret prompt")
    expect(JSON.stringify(auditSink.list())).not.toContain("secret prompt")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret prompt")
  })

  it("sanitizes network listen failure audit metadata", async () => {
    const rawError = "listen failed token=sk-secret /Users/example/repo"
    const auditSink = new InMemoryAuditSink()
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: {
        register: async (descriptor: Parameters<ReturnType<typeof createNetworkServiceRegistry>["register"]>[0]) => {
          await descriptor.audit?.({
            action: "failed",
            serviceId: "side-channel.send",
            role: "http",
            binding: { id: "side-channel.send", port: 49999, bindAddress: "127.0.0.1" },
            timestamp: "2026-05-15T00:00:00.000Z",
            error: rawError,
          })
          throw new Error(rawError)
        },
        unregister: async () => {},
        list: () => [],
        conflictPolicy: "next-available",
      },
      dataRepository: fakeDataRepository(new MemoryNamespace<OutboxEntryV1>("outbox")),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      auditSink,
      token: "tok",
    })

    await expect(service.start()).rejects.toThrow(rawError)

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "network.listen",
        outcome: "failed",
        metadata: expect.objectContaining({
          action: "failed",
          role: "http",
          bindAddress: "127.0.0.1",
          port: 49999,
          errorName: "Error",
          errorLength: rawError.length,
        }),
      }),
    ])
    expect(JSON.stringify(auditSink.list())).not.toContain("sk-secret")
    expect(JSON.stringify(auditSink.list())).not.toContain("/Users/example/repo")
  })

  it("fails side-channel sends when the reply target dispatcher is missing", async () => {
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const auditSink = new InMemoryAuditSink()
    const warn = vi.fn()
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(outbox),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      auditSink,
      logger: fakeLogger({ warn }),
      token: "tok",
    })
    service.rememberReplyTarget(bridgeTarget())

    await expect(service.send({
      project: "project-1",
      sessionKey: "bridge:s1",
      message: "generated file is ready",
    })).rejects.toThrow("dispatch failed")

    const outboxEntries = await outbox.list()
    expect(outboxEntries).toEqual([
      expect.objectContaining({
        status: "failed",
        lastError: "dispatch failed",
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        metadata: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "bridge:s1",
          transportKind: "bridge",
          connectorId: "bridge",
          attachmentCount: 0,
          errorName: "Error",
          errorCode: "dispatch_unavailable",
          errorLength: "dispatcher is unavailable".length,
        }),
      }),
    ])
    expect(warn).toHaveBeenCalledWith("Side-channel send dispatch failed.", expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      transportKind: "bridge",
      connectorId: "bridge",
      attachmentCount: 0,
      errorName: "Error",
      errorCode: "dispatch_unavailable",
      errorLength: "dispatcher is unavailable".length,
    }))
    expect(JSON.stringify(auditSink.list())).not.toContain("generated file is ready")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("generated file is ready")
  })

  it("logs failed relay HTTP requests with source session context", async () => {
    const warn = vi.fn()
    const logger = fakeLogger({ warn })
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(new MemoryNamespace<OutboxEntryV1>("outbox")),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
      token: "tok",
    })
    await service.start()
    const env = service.getAgentEnv("project-1", "bridge:s1")
    service.rememberReplyTarget(bridgeTarget())
    service.registerRelaySendHandler(async () => {
      throw new Error("relay failed with secret prompt")
    })

    const response = await fetch(env?.SYNAPSE_RELAY_SEND_URL ?? "", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env?.SYNAPSE_SIDE_CHANNEL_TOKEN ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceProjectId: "project-1",
        sourceSessionKey: "bridge:s1",
        message: "secret prompt body",
      }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "internal error",
      },
    })
    expect(warn).toHaveBeenCalledWith("Side-channel HTTP request failed.", expect.objectContaining({
      path: "/relay/send",
      method: "POST",
      projectId: "project-1",
      sessionKey: "bridge:s1",
      messageLength: 18,
      imageCount: 0,
      fileCount: 0,
      errorCode: "internal_error",
      status: 500,
      boundary: "side-channel-http",
      errorName: "Error",
      errorLength: "relay failed with secret prompt".length,
    }))
    expect(JSON.stringify(warn.mock.calls)).not.toContain("relay failed with secret prompt")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret prompt body")
    await service.stop()
  })

  it("redacts failed Agent event dispatch diagnostics and falls back to target conversation", async () => {
    const warn = vi.fn()
    const logger = fakeLogger({ warn })
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(new MemoryNamespace<OutboxEntryV1>("outbox")),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
      token: "tok",
    })
    service.registerDispatcher("bridge", {
      dispatchAgentEvent: async () => {
        throw new Error("dispatcher failed with secret prompt")
      },
      dispatchSideChannelSend: async () => {},
    })

    service.dispatchAgentEvent(bridgeTarget(), {
      type: "error",
      message: "agent result failed",
      projectId: "project-1",
      sdkSessionId: "sdk-session-1",
    })

    await expectEventually(async () => warn.mock.calls.length, 1)
    expect(warn).toHaveBeenCalledWith("Reply target dispatch failed.", expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      transportKind: "bridge",
      connectorId: "bridge",
      eventType: "error",
      conversationId: "conv-1",
      sdkSessionId: "sdk-session-1",
      errorName: "Error",
      errorLength: "dispatcher failed with secret prompt".length,
    }))
    expect(JSON.stringify(warn.mock.calls)).not.toContain("dispatcher failed with secret prompt")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("agent result failed")
  })

  it("logs missing Agent event dispatchers with target conversation context", () => {
    const warn = vi.fn()
    const logger = fakeLogger({ warn })
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(new MemoryNamespace<OutboxEntryV1>("outbox")),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
      token: "tok",
    })

    service.dispatchAgentEvent(bridgeTarget(), {
      type: "result",
      content: "done",
      projectId: "project-1",
      sdkSessionId: "sdk-session-1",
    })

    expect(warn).toHaveBeenCalledWith("Reply target dispatcher missing.", expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      transportKind: "bridge",
      connectorId: "bridge",
      eventType: "result",
      conversationId: "conv-1",
      sdkSessionId: "sdk-session-1",
    }))
    expect(JSON.stringify(warn.mock.calls)).not.toContain("done")
  })

  it("rejects empty send, unknown project, missing session target, and unauthorized HTTP", async () => {
    const service = new SideChannelService({
      projectContainers: fakeProjectContainers(),
      networkRegistry: createNetworkServiceRegistry(),
      dataRepository: fakeDataRepository(new MemoryNamespace<OutboxEntryV1>("outbox")),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      token: "tok",
    })
    await service.start()
    const env = service.getAgentEnv("project-1", "s1")
    const unauthorized = await fetch(env?.SYNAPSE_SIDE_CHANNEL_URL ?? "", {
      method: "POST",
      body: JSON.stringify({ project: "project-1", sessionKey: "s1", message: "hi" }),
    })
    expect(unauthorized.status).toBe(401)

    await expect(service.send({ project: "project-1", sessionKey: "s1" }))
      .rejects.toThrow(/message or attachment/)
    await expect(service.send({ project: "missing", sessionKey: "s1", message: "hi" }))
      .rejects.toThrow(/project/)
    await expect(service.send({ project: "project-1", sessionKey: "s1", message: "hi" }))
      .rejects.toThrow(/reply target/)
    await service.stop()
  })
})

describe("side-channel attachment policy", () => {
  it("normalizes Windows-reserved attachment file names", () => {
    expect(sanitizeAttachmentFileName("C:\\temp\\CON.txt"))
      .toBe("_CON.txt")
    expect(sanitizeAttachmentFileName("aux. "))
      .toBe("_aux")
  })

  it("rejects oversized attachments and invalid image MIME", async () => {
    await expect(prepareSideChannelAttachments({
      files: [{
        data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
        fileName: "big.txt",
        mimeType: "text/plain",
      }],
    })).rejects.toMatchObject({ code: "attachment_too_large" })

    await expect(prepareSideChannelAttachments({
      images: [{
        data: Buffer.from("not-image").toString("base64"),
        fileName: "note.txt",
        mimeType: "text/plain",
      }],
    })).rejects.toMatchObject({ code: "unsupported_image_mime" })
  })

  it("rejects malformed inline attachment base64", async () => {
    await expect(prepareSideChannelAttachments({
      files: [{
        data: "%%%not-base64%%%",
        fileName: "bad.txt",
        mimeType: "text/plain",
      }],
    })).rejects.toMatchObject({ code: "invalid_attachment_data" })
  })

  it("rejects path escapes and symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synapse-side-channel-"))
    const workspace = path.join(root, "workspace")
    const outside = path.join(root, "outside.txt")
    await mkdir(workspace)
    await writeFile(outside, "outside")
    const link = path.join(workspace, "link.txt")
    await symlink(outside, link)

    await expect(prepareSideChannelAttachments({
      files: [{ path: outside, mimeType: "text/plain" }],
      workspacePath: workspace,
      permissionGuard: createPermissionGuard(),
    })).rejects.toMatchObject({ code: "path_escape_rejected" })

    await expect(prepareSideChannelAttachments({
      files: [{ path: link, mimeType: "text/plain" }],
      workspacePath: workspace,
    })).rejects.toBeInstanceOf(AttachmentPolicyError)
  })
})

function bridgeTarget(): ReplyTarget {
  return {
    projectId: "project-1",
    sessionKey: "bridge:s1",
    conversationId: "conv-1",
    transport: { kind: "bridge", connectorId: "bridge" },
    replyCtx: {
      kind: "bridge",
      platform: "bridge",
      replyCtx: "ctx-1",
    },
  }
}

class FakeDispatcher implements ReplyTransportDispatcher {
  readonly sideChannelPayloads: Array<{
    readonly target: ReplyTarget
    readonly message?: string
    readonly attachmentCount: number
  }> = []

  async dispatchAgentEvent(): Promise<void> {}

  async dispatchSideChannelSend(
    target: ReplyTarget,
    payload: Parameters<ReplyTransportDispatcher["dispatchSideChannelSend"]>[1],
  ): Promise<void> {
    this.sideChannelPayloads.push({
      target,
      message: payload.message,
      attachmentCount: payload.attachments.length,
    })
  }
}

function fakeProjectContainers() {
  return {
    open: async () => ({
      get: () => {
        throw new Error("not used")
      },
      inspect: () => [],
      dispose: async () => {},
      projectId: "project-1",
    }),
    peek: () => undefined,
    close: async () => {},
    list: () => [],
    registerService: () => {},
    setQuota: () => {},
  }
}

function fakeDataRepository(outbox: DataNamespace<OutboxEntryV1>): DataRepository {
  return {
    namespace: <T,>() => outbox as unknown as DataNamespace<T>,
    exportAll: async () => ({ format: "synapse-backup-v1", exportedAt: "", namespaces: [] }),
    importAll: async () => {},
    inspect: () => [],
  }
}

function fakeLogger(overrides: Partial<StructuredLogger> = {}): StructuredLogger {
  const logger: StructuredLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    ...overrides,
  }
  return logger
}

async function expectEventually<T>(read: () => Promise<T>, expected: T): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (await read() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(await read()).toBe(expected)
}

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
