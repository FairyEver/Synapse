import { Buffer } from "node:buffer"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

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
  type ReplyTransportDispatcher,
} from "../index"

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
