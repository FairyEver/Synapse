import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import type { DataNamespace } from "../../../runtime/data-repo"
import {
  createPermissionGuard,
  InMemoryAuditSink,
  type PermissionGuard,
} from "../../../runtime/security"
import {
  AttachmentStagingService,
  type AgentAttachmentMetadataEntry,
} from "../attachment-staging-service"
import { directoriesForPathAttachments } from "../attachments"

describe("AttachmentStagingService", () => {
  it("stages 50 images while returning references without image bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-staging-"))
    try {
      let nextId = 0
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.attachments")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        now: () => new Date("2026-08-25T00:00:00.000Z"),
        randomId: () => `attachment_${nextId += 1}`,
      })

      const staged = await service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: Array.from({ length: 50 }, (_, index) => ({
          kind: "image" as const,
          name: `image-${index + 1}.png`,
          mimeType: "image/png" as const,
          data: pngBytes(index),
        })),
      })

      expect(staged).toHaveLength(50)
      expect(staged[0]).toEqual(expect.objectContaining({
        lifecycle: "staged",
        draftScopeId: "draft_1",
        ref: expect.objectContaining({
          version: 2,
          attachmentId: "attachment_1",
          kind: "image",
          name: "image-1.png",
        }),
      }))
      expect(JSON.stringify(staged)).not.toMatch(/"(?:data|bytes|base64)":/)
      const rows = await metadata.list()
      expect(rows).toHaveLength(50)
      const firstRow = rows[0]
      if (!firstRow || firstRow.kind === "directory") throw new Error("Expected a stored image attachment")
      expect(await readFile(firstRow.storagePath)).toEqual(Buffer.from(pngBytes(0)))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("commits staged attachments without changing their public identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-commit-"))
    try {
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.attachments")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => "attachment_1",
        createImageDerivatives: async () => ({
          preview: pngBytes(1),
          thumbnail: pngBytes(2),
          previewMimeType: "image/png",
          thumbnailMimeType: "image/png",
          width: 2048,
          height: 1024,
          previewWidth: 1568,
          previewHeight: 784,
        }),
      })
      const [staged] = await service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          data: pngBytes(0),
        }],
      })

      const [committed] = await service.commit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: [staged.ref.attachmentId],
        conversationId: "conversation_1",
        turnId: "turn_1",
      })

      expect(committed.ref).toEqual(staged.ref)
      expect(committed.ref).toMatchObject({ previewByteSize: pngBytes(1).byteLength })
      expect(committed).toEqual(expect.objectContaining({
        lifecycle: "committed",
        conversationId: "conversation_1",
        turnId: "turn_1",
      }))
      expect(await metadata.get(staged.ref.attachmentId)).toEqual(expect.objectContaining({
        lifecycle: "committed",
        conversationId: "conversation_1",
        turnId: "turn_1",
      }))
      const runtime = await service.resolveCommittedForRuntime({
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        attachmentIds: [staged.ref.attachmentId],
      })
      expect(runtime.attachments).toEqual([expect.objectContaining({
        kind: "path",
        entryType: "image",
        name: "image.png",
      })])
      expect(await readFile(runtime.attachments[0]!.path)).toEqual(Buffer.from(pngBytes(0)))
      expect(runtime.controlledDirectories).toEqual([
        path.join(root, "staged", "project_1", "draft_1"),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rolls a failed turn back to a retryable staged attachment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-rollback-"))
    try {
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.attachments")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => "attachment_1",
      })
      const [staged] = await service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          data: pngBytes(0),
        }],
      })
      await service.commit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: [staged.ref.attachmentId],
        conversationId: "conversation_1",
        turnId: "turn_1",
      })

      await service.rollbackCommit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: [staged.ref.attachmentId],
        conversationId: "conversation_1",
        turnId: "turn_1",
      })

      expect(await metadata.get(staged.ref.attachmentId)).toEqual(expect.objectContaining({
        lifecycle: "staged",
        draftScopeId: "draft_1",
      }))
      expect(await metadata.get(staged.ref.attachmentId)).not.toHaveProperty("conversationId")
      await expect(service.commit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: [staged.ref.attachmentId],
        conversationId: "conversation_2",
        turnId: "turn_2",
      })).resolves.toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("serializes concurrent quota checks so no draft can exceed 50 images", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-concurrent-staging-"))
    try {
      let nextId = 0
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => `attachment_${nextId += 1}`,
      })
      const stageThirty = () => service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: Array.from({ length: 30 }, (_, index) => ({
          kind: "image" as const,
          name: `image-${index}.png`,
          mimeType: "image/png" as const,
          data: pngBytes(index),
        })),
      })

      const results = await Promise.allSettled([stageThirty(), stageThirty()])

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
      expect(await metadata.list()).toHaveLength(30)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects forged image MIME before writing metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-mime-staging-"))
    try {
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })

      await expect(service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "forged.jpg",
          mimeType: "image/jpeg",
          data: pngBytes(0),
        }],
      })).rejects.toThrow("图片格式无效。")
      expect(await metadata.list()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ["image/jpeg", "photo.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])],
    ["image/png", "screen.png", pngBytes(0)],
    ["image/gif", "animation.gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ["image/webp", "picture.webp", Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ])],
  ] as const)("accepts supported %s magic before derivative decoding", async (mimeType, name, data) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-supported-image-"))
    try {
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })
      await expect(service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{ kind: "image", name, mimeType, data }],
      })).resolves.toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rolls back the original when image derivative decoding fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-corrupt-image-"))
    const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
    try {
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        createImageDerivatives: async () => { throw new Error("无法解码图片附件。") },
      })
      await expect(service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "corrupt.png",
          mimeType: "image/png",
          data: pngBytes(0),
        }],
      })).rejects.toThrow("无法解码图片附件")
      expect(await metadata.list()).toEqual([])
      expect(await readdir(path.join(root, "staged", "project_1", "draft_1"))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects 51 images in one draft without leaving partial metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-51-images-"))
    const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
    try {
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })
      await expect(service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: Array.from({ length: 51 }, (_, index) => ({
          kind: "image" as const,
          name: `image-${index}.png`,
          mimeType: "image/png" as const,
          data: pngBytes(index),
        })),
      })).rejects.toThrow("图片附件最多 50 张")
      expect(await metadata.list()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("cleans expired staged files and metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-expired-staging-"))
    try {
      let now = new Date("2026-08-25T00:00:00.000Z")
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        now: () => now,
        randomId: () => "attachment_1",
      })
      await service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          data: pngBytes(0),
        }],
      })
      const row = await metadata.get("attachment_1")
      if (!row || row.kind === "directory") throw new Error("Expected a stored image attachment")
      now = new Date("2026-08-27T00:00:00.000Z")

      await expect(service.cleanupExpired()).resolves.toBe(1)

      expect(await metadata.list()).toEqual([])
      await expect(stat(row.storagePath)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("copies individual files but keeps explicitly selected directories exact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-path-staging-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-path-source-"))
    try {
      const sourceFile = path.join(sourceRoot, "report.md")
      const sourceDirectory = path.join(sourceRoot, "materials")
      await writeFile(sourceFile, "report")
      await mkdir(sourceDirectory)
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: (() => {
          let nextId = 0
          return () => `attachment_${nextId += 1}`
        })(),
      })

      const staged = await service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourceFile, sourceDirectory],
      })

      expect(staged[0]?.ref).toEqual(expect.objectContaining({
        kind: "file",
        name: "report.md",
      }))
      expect(staged[0]?.ref).not.toHaveProperty("path")
      expect(staged[1]?.ref).toEqual(expect.objectContaining({
        kind: "directory",
        path: sourceDirectory,
      }))
      const fileRow = await metadata.get("attachment_1")
      if (!fileRow || fileRow.kind === "directory") throw new Error("Expected a stored file attachment")
      expect(await readFile(fileRow.storagePath, "utf8")).toBe("report")
      expect(path.dirname(fileRow.storagePath)).not.toBe(sourceRoot)
      expect(await readdir(path.dirname(fileRow.storagePath))).toEqual(["original.md"])
      const committed = await service.commit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: ["attachment_1"],
        conversationId: "conversation_1",
        turnId: "turn_1",
      })
      const runtime = await service.resolveCommittedForRuntime({
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        attachmentIds: committed.map((item) => item.ref.attachmentId),
      })
      expect(directoriesForPathAttachments({ cwd: "/workspace", attachments: runtime.attachments }))
        .toEqual([path.dirname(fileRow.storagePath)])
      expect(runtime.controlledDirectories).toEqual([
        path.join(root, "staged", "project_1", "draft_1"),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("rejects selected paths that traverse a symlinked ancestor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-symlink-root-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-symlink-source-"))
    try {
      const actual = path.join(sourceRoot, "actual")
      const linked = path.join(sourceRoot, "linked")
      await mkdir(actual)
      await writeFile(path.join(actual, "secret.md"), "secret")
      await symlink(actual, linked, "dir")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })

      await expect(service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [path.join(linked, "secret.md")],
      })).rejects.toThrow("符号链接")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("rejects an exact directory that contains a nested symlink", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-root-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-source-"))
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-outside-"))
    try {
      const nested = path.join(sourceRoot, "nested")
      const outsideFile = path.join(outsideRoot, "secret.md")
      await mkdir(nested)
      await writeFile(outsideFile, "secret")
      await symlink(outsideFile, path.join(nested, "linked-secret.md"))
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })

      await expect(service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourceRoot],
      })).rejects.toThrow("符号链接")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("revalidates a committed directory before materializing it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-revalidate-root-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-revalidate-source-"))
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-directory-revalidate-outside-"))
    try {
      const outsideFile = path.join(outsideRoot, "secret.md")
      await writeFile(outsideFile, "secret")
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => "attachment_1",
      })
      const staged = await service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourceRoot],
      })
      await service.commit({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachmentIds: staged.map((item) => item.ref.attachmentId),
        conversationId: "conversation_1",
        turnId: "turn_1",
      })
      await symlink(outsideFile, path.join(sourceRoot, "linked-secret.md"))

      await expect(service.resolveCommittedForRuntime({
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        attachmentIds: ["attachment_1"],
      })).rejects.toThrow("符号链接")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it("rejects an oversized regular file before copying it into controlled storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-large-file-root-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-large-file-source-"))
    try {
      const sourceFile = path.join(sourceRoot, "large.bin")
      await writeFile(sourceFile, "")
      await truncate(sourceFile, 500 * 1024 * 1024 + 1)
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
      })

      await expect(service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourceFile],
      })).rejects.toThrow("本轮附件总大小过大")
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it("stages a selected image path as an image reference without returning bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-image-path-"))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-image-source-"))
    try {
      const sourceImage = path.join(sourceRoot, "screen.png")
      await writeFile(sourceImage, pngBytes(0))
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata: new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts"),
        permissionGuard: createPermissionGuard(),
        auditSink: new InMemoryAuditSink(),
        randomId: () => "attachment_1",
      })

      const [staged] = await service.stagePaths({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        paths: [sourceImage],
      })

      expect(staged?.ref).toEqual(expect.objectContaining({
        kind: "image",
        name: "screen.png",
        mimeType: "image/png",
      }))
      expect(JSON.stringify(staged)).not.toMatch(/"(?:data|bytes|base64)":/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it("records a denial without writing staged data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-denied-staging-"))
    try {
      const metadata = new MemoryNamespace<AgentAttachmentMetadataEntry>("agent.artifacts")
      const auditSink = new InMemoryAuditSink()
      const permissionGuard: PermissionGuard = {
        registerPolicy: () => () => {},
        check: async () => ({ allowed: false, reason: "denied by test" }),
      }
      const service = new AttachmentStagingService({
        rootDirectory: root,
        metadata,
        permissionGuard,
        auditSink,
      })

      await expect(service.stageBytes({
        actor: { kind: "user", id: "renderer" },
        projectId: "project_1",
        draftScopeId: "draft_1",
        attachments: [{
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          data: pngBytes(0),
        }],
      })).rejects.toThrow("没有附件操作权限。")

      expect(await metadata.list()).toEqual([])
      expect(auditSink.list()).toEqual([
        expect.objectContaining({
          action: "fs.write",
          resource: "agent-attachment:staging",
          outcome: "denied",
        }),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
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
