import { mkdtemp, readFile, rm, writeFile, type FileHandle } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../runtime/data-repo"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../../runtime/security"
import {
  AttachmentStagingService,
  type AgentAttachmentMetadataEntry,
} from "../attachment-staging-service"

// Windows 上的 fsync 就是 FlushFileBuffers，而它要求句柄带 GENERIC_WRITE：只读句柄上调用返回
// ERROR_ACCESS_DENIED，Node 抛 EPERM；POSIX 上对只读 fd fsync 是合法的。把这条平台契约搬到
// 所有平台上，附件写入路径才不会只在 Windows 上红。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    open: async (target: string | Buffer | URL, flags: string | number, mode?: number) => {
      const handle = await actual.open(target, flags, mode)
      if (isWriteCapable(flags)) return handle
      return readOnlyHandle(handle)
    },
  }
})

function isWriteCapable(flags: string | number): boolean {
  if (typeof flags === "string") return /[+wa]/.test(flags)
  return (flags & 0o3) !== 0o0
}

function readOnlyHandle(handle: FileHandle): FileHandle {
  return {
    close: () => handle.close(),
    createReadStream: (options?: Parameters<FileHandle["createReadStream"]>[0]) =>
      handle.createReadStream(options),
    readFile: (options?: Parameters<FileHandle["readFile"]>[0]) => handle.readFile(options),
    stat: () => handle.stat(),
    sync: () => Promise.reject(Object.assign(new Error("EPERM: operation not permitted, fsync"), {
      code: "EPERM",
      syscall: "fsync",
    })),
  } as unknown as FileHandle
}

describe("Agent 附件写入路径", () => {
  it("图片附件落盘时不对只读句柄 fsync", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-fsync-root-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-fsync-source-"))
    try {
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.attachments")
      let nextId = 0
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => `attachment_${nextId += 1}`,
        createImageDerivatives: async (bytes, mimeType) => ({
          preview: bytes,
          thumbnail: bytes,
          previewMimeType: mimeType,
          thumbnailMimeType: mimeType,
        }),
      })

      const stagedBytes = await service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image" as const,
          name: "clipboard.png",
          mimeType: "image/png" as const,
          data: pngBytes(1),
        }],
      })
      expect(stagedBytes).toHaveLength(1)

      const sourcePath = path.join(sourceRoot, "screenshot.png")
      await writeFile(sourcePath, pngBytes(2))
      const stagedPaths = await service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourcePath],
      })
      expect(stagedPaths).toHaveLength(1)

      const rows = await metadata.list()
      const stored = rows.find((row) => row.id === stagedPaths[0]?.ref.attachmentId)
      if (!stored || stored.kind === "directory") throw new Error("Expected a stored image attachment")
      expect(await readFile(stored.storagePath)).toEqual(Buffer.from(pngBytes(2)))
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })
})

function pngBytes(seed: number): Uint8Array {
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, seed % 256])
}

class MemoryNamespace<T extends { readonly id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 2
  readonly backend = "sqlite" as const
  private readonly rows = new Map<string, T>()

  constructor(readonly name: string) {}

  getSingleton(): Promise<T | null> {
    return Promise.resolve(null)
  }

  setSingleton(_value: T): Promise<void> {
    return Promise.resolve()
  }

  list(filter?: Partial<T>): Promise<T[]> {
    const values = Array.from(this.rows.values())
    if (!filter) return Promise.resolve(values)
    return Promise.resolve(values.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key as keyof T] === value)))
  }

  get(id: string): Promise<T | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

  upsert(item: T): Promise<void> {
    this.rows.set(item.id, item)
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    this.rows.delete(id)
    return Promise.resolve()
  }

  onChange(): () => void {
    return () => {}
  }
}
