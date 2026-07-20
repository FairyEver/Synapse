import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const guardedFetchMock = vi.hoisted(() => ({
  createGuardedFetchUrl: vi.fn((options: {
    readonly beforeRequest?: (url: URL) => Promise<void> | void
  } = {}) => async (url: string) => {
    await options.beforeRequest?.(new URL(url))
    if (url.includes("redirect-source")) {
      const redirectedUrl = new URL("https://cdn.example.com/final?token=redirect-secret")
      await options.beforeRequest?.(redirectedUrl)
      return {
        url: redirectedUrl.toString(),
        status: 200,
        headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
        text: async () => "<html><body><h1>Redirected</h1></body></html>",
      }
    }
    return {
      url,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
      text: async () => "<html><body><h1>Article</h1><p>Body</p></body></html>",
    }
  }),
}))

import { createInMemoryHarness } from "../../../runtime/ipc"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES } from "../../../../config"
import type { SynapseKnowledgeBaseStorageStatus } from "../../../../src/types/knowledge-base"
import { KnowledgeBaseService } from "../../../services/knowledge-base/knowledge-base-service"
import type { KnowledgeBaseStorageMigrationState } from "../../../services/knowledge-base/storage-migration-service"
import { knowledgeBaseIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => path.join(os.tmpdir(), "synapse-kb-userdata"),
  },
  focusedWindow: { id: "focused-window" },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    trashItem: vi.fn(),
  },
}))

const sourceManagerWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(),
  trackMutation: vi.fn((run: () => Promise<unknown>) => run()),
}))

vi.mock("electron", () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  dialog: electronMock.dialog,
  shell: electronMock.shell,
}))

vi.mock("../../../services/knowledge-base/source-manager-window-service", () => ({
  knowledgeBaseSourceManagerWindowService: sourceManagerWindowServiceMock,
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

vi.mock("../../../services/source-acquisition/guarded-fetch-url", () => ({
  createGuardedFetchUrl: guardedFetchMock.createGuardedFetchUrl,
}))

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ipc-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledgeBaseIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardedFetchMock.createGuardedFetchUrl.mockClear()
    electronMock.dialog.showOpenDialog.mockReset()
    sourceManagerWindowServiceMock.open.mockReset()
    sourceManagerWindowServiceMock.trackMutation.mockReset()
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    electronMock.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/source.md"] })
    sourceManagerWindowServiceMock.open.mockResolvedValue(undefined)
    sourceManagerWindowServiceMock.trackMutation.mockImplementation((run: () => Promise<unknown>) => run())
  })

  it("creates a managed knowledge base through guarded write permission", async () => {
    const createManaged = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      projectPath: "synapse-kb://kb-1",
      runtimePath: "/UserData/knowledge-bases/kb-1",
      templateVersion: "2026-05-24",
      templateSource: {
        repo: "https://github.com/AgriciDaniel/claude-obsidian",
        commit: "75d3b6feb77b96c6bb16599c4550cc9703553d87",
        syncedAt: "2026-05-24",
      },
    })
    const { harness, permissionGuard } = createHarness({ service: { createManaged } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:create_managed", {
      projectId: "kb-1",
      name: "Knowledge",
    }) as { projectPath: string; runtimePath?: string }

    expect(createManaged).toHaveBeenCalledWith({ projectId: "kb-1", name: "Knowledge" })
    expect(result.projectPath).toBe("synapse-kb://kb-1")
    expect(result.runtimePath).toBeUndefined()
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.createManaged" },
    })
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Knowledge Base IPC request.", expect.objectContaining({
      action: "fs.write",
      boundary: "knowledge-base.ipc.operation",
      projectId: "kb-1",
      resourceKind: "managed-knowledge-base",
      source: "knowledgeBase.createManaged",
    }))
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Knowledge Base IPC completed.", expect.objectContaining({
      action: "fs.write",
      boundary: "knowledge-base.ipc.operation",
      durationMs: expect.any(Number),
      projectId: "kb-1",
      source: "knowledgeBase.createManaged",
    }))
  })

  it("logs guarded IPC failures without leaking error text", async () => {
    const createManaged = vi.fn().mockRejectedValue(new Error("failed with token=secret-token at /Users/liyang/private"))
    const { auditSink, harness } = createHarness({ service: { createManaged } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:create_managed", {
      projectId: "kb-1",
      name: "Knowledge",
    })).rejects.toThrow("failed with token=secret-token at /Users/liyang/private")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith("Knowledge Base IPC failed.", expect.objectContaining({
      action: "fs.write",
      boundary: "knowledge-base.ipc.operation",
      errorLength: "Error: failed with token=secret-token at /Users/liyang/private".length,
      errorName: "Error",
      projectId: "kb-1",
      source: "knowledgeBase.createManaged",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "knowledgeBase.createManaged",
        errorName: "Error",
        error: "Error: failed with token=[redacted] at [path]",
      }),
    }))
    const auditFailure = JSON.stringify(vi.mocked(auditSink.record).mock.calls)
    expect(auditFailure).not.toContain("secret-token")
    expect(auditFailure).not.toContain("/Users/liyang/private")
    const loggedFailure = JSON.stringify(logStoreMock.logger.warn.mock.calls)
    expect(loggedFailure).not.toContain("secret-token")
    expect(loggedFailure).not.toContain("/Users/liyang/private")
  })

  it("blocks managed knowledge base creation during storage migration", async () => {
    const createManaged = vi.fn()
    const { harness } = createHarness({ migrationActive: true, service: { createManaged } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:create_managed", {
      projectId: "kb-1",
      name: "Knowledge",
    })).rejects.toThrow("知识库存储迁移正在进行")

    expect(createManaged).not.toHaveBeenCalled()
  })

  it("deletes a managed knowledge base through guarded write permission", async () => {
    const deleteManaged = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      runtimePath: "/UserData/knowledge-bases/kb-1",
      deleted: true,
    })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { deleteManaged } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:delete_managed", {
      projectId: "kb-1",
      runtimeId: "kb-1",
    })

    expect(result).toEqual({
      projectId: "kb-1",
      deleted: true,
    })
    expect(deleteManaged).toHaveBeenCalledWith({ projectId: "kb-1", runtimeId: "kb-1" })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.deleteManaged" },
    })
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      outcome: "allowed",
      metadata: { source: "knowledgeBase.deleteManaged" },
    })
  })

  it("checks delete permission against the requested runtime target", async () => {
    const deleteManaged = vi.fn().mockResolvedValue({
      projectId: "project-1",
      runtimePath: "/UserData/knowledge-bases/kb-victim",
      deleted: true,
    })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { deleteManaged } })

    await harness.invoke("synapse:app:knowledge_base:operation:delete_managed", {
      projectId: "project-1",
      runtimeId: "kb-victim",
    })

    expect(deleteManaged).toHaveBeenCalledWith({ projectId: "project-1", runtimeId: "kb-victim" })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-victim",
      context: { source: "knowledgeBase.deleteManaged" },
    })
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-victim",
      outcome: "allowed",
      metadata: { source: "knowledgeBase.deleteManaged" },
    })
  })

  it("blocks managed knowledge base deletion during storage migration", async () => {
    const deleteManaged = vi.fn()
    const { harness } = createHarness({ migrationActive: true, service: { deleteManaged } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:delete_managed", {
      projectId: "kb-1",
      runtimeId: "kb-1",
    })).rejects.toThrow("知识库存储迁移正在进行")

    expect(deleteManaged).not.toHaveBeenCalled()
  })

  it("adds a URL source through guarded network and write permissions", async () => {
    const addUrlSource = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      uploaded: [{
        originalPath: "https://example.com/article",
        relativePath: ".raw/web/2026/05/24/article.md",
        name: "article.md",
        size: 128,
        sourceKind: "url",
        sourceUrl: "https://example.com/article",
      }],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ service: { addUrlSource } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      url: "https://example.com/article?token=secret-token",
    }) as { uploaded: unknown[] }

    expect(addUrlSource).toHaveBeenCalledWith({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      url: "https://example.com/article?token=secret-token",
    }, expect.objectContaining({
      fetchUrl: expect.any(Function),
    }))
    expect(result.uploaded).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://example.com/article?token=%5Bredacted%5D",
      context: { source: "knowledgeBase.addUrlSource.fetch" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.addUrlSource" },
    })
  })

  it("checks redirected URL source targets through guarded network permissions", async () => {
    const addUrlSource = vi.fn(async (
      _request: { projectId: string; url: string },
      options: { fetchUrl: (url: string, init: { readonly signal: AbortSignal }) => Promise<unknown> },
    ) => {
      await options.fetchUrl("https://example.com/redirect-source?token=initial-secret", {
        signal: new AbortController().signal,
      })
      return {
        projectId: "kb-1",
        uploaded: [{
          originalPath: "https://example.com/redirect-source",
          relativePath: ".raw/web/2026/05/24/final.md",
          name: "final.md",
          size: 128,
          sourceKind: "url",
          sourceUrl: "https://example.com/redirect-source",
        }],
        skipped: [],
      }
    })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { addUrlSource } })

    await harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      url: "https://example.com/redirect-source?token=initial-secret",
    })

    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://example.com/redirect-source?token=%5Bredacted%5D",
      context: { source: "knowledgeBase.addUrlSource.fetch" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.addUrlSource" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(3, {
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://cdn.example.com/final?token=%5Bredacted%5D",
      context: { source: "knowledgeBase.addUrlSource.fetch" },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "https://cdn.example.com/final?token=%5Bredacted%5D",
      metadata: { source: "knowledgeBase.addUrlSource.fetch" },
    }))
  })

  it("allows URL acquisition skipped reasons in add URL results", async () => {
    const addUrlSource = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      uploaded: [],
      skipped: [{
        path: "https://example.com/missing",
        reason: "network_error",
      }],
    })
    const { harness } = createHarness({ service: { addUrlSource } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      url: "https://example.com/missing",
    }) as { skipped: Array<{ reason: string }> }

    expect(result.skipped).toEqual([{
      path: "https://example.com/missing",
      reason: "network_error",
    }])
  })

  it("does not request network permission before deterministic URL validation failures", async () => {
    const addUrlSource = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      uploaded: [],
      skipped: [{
        path: "file:///tmp/source.html",
        reason: "unsupported_protocol",
      }],
    })
    const { harness, permissionGuard } = createHarness({ service: { addUrlSource } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      url: "file:///tmp/source.html",
    }) as { skipped: Array<{ reason: string }> }

    expect(result.skipped).toEqual([{
      path: "file:///tmp/source.html",
      reason: "unsupported_protocol",
    }])
    expect(addUrlSource).toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "managed-knowledge-base:kb-1",
    }))
  })

  it("does not audit network failure when URL source write is denied", async () => {
    const addUrlSource = vi.fn()
    const { auditSink, harness } = createHarness({
      service: { addUrlSource },
      permissions: [
        { allowed: true },
        { allowed: false, reason: "Write denied", policyId: "kb-write" },
      ],
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      url: "https://example.com/article",
    })).rejects.toThrow("Write denied")

    expect(addUrlSource).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "https://example.com/article",
      metadata: { source: "knowledgeBase.addUrlSource.fetch" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "managed-knowledge-base:kb-1",
      metadata: {
        source: "knowledgeBase.addUrlSource",
        reason: "Write denied",
        policyId: "kb-write",
      },
    }))
    expect(vi.mocked(auditSink.record).mock.calls.some(([event]) => (
      event.action === "network.connect" && event.outcome === "failed"
    ))).toBe(false)
  })

  it("adds a URL source through IPC into the real knowledge base service", async () => {
    const userDataPath = await tempDir()
    const projectPath = path.join(userDataPath, "knowledge-bases", "kb-1")
    const service = new KnowledgeBaseService({
      userDataPath,
      loadConfig: async () => ({
        activeRepoUuid: null,
        repositories: [],
        global: {
          ...DEFAULT_GLOBAL_CONFIG,
          projects: [{
            id: "kb-1",
            name: "Knowledge",
            path: "synapse-kb://kb-1",
            capabilities: {
              knowledgeBase: {
                enabled: true,
                schemaVersion: 1,
                templateVersion: "2026-05-24",
                managed: true,
                runtimeId: "kb-1",
              },
            },
          }],
        },
        agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
      }),
      now: () => new Date("2026-05-24T10:20:30.000Z"),
      fetchUrl: async () => ({
        url: "https://example.com/article",
        status: 200,
        headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
        text: async () => "<html><body><h1>Article</h1><p>Body</p></body></html>",
      }),
    })
    const { harness, permissionGuard } = createHarness({ service })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:add_url_source", {
      projectId: "kb-1",
      url: "https://example.com/article",
    }) as { uploaded: Array<{ relativePath: string }> }

    expect(result.uploaded).toEqual([expect.objectContaining({
      relativePath: ".raw/web/2026/05/24/article.md",
    })])
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "network.connect",
      resource: "https://example.com/article",
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "fs.write",
      resource: "managed-knowledge-base:kb-1",
    }))
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "article.md"), "utf8"))
      .resolves.toContain('source_url: "https://example.com/article"')
  })

  it("opens the source manager window through guarded read permission", async () => {
    const { harness, migrationService, permissionGuard } = createHarness({ service: {} })

    await harness.invoke("synapse:app:knowledge_base:operation:open_source_manager", {
      projectId: "project-1",
      projectName: "知识库001",
    })

    expect(sourceManagerWindowServiceMock.open).toHaveBeenCalledWith({
      projectId: "project-1",
      projectName: "知识库001",
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:project-1",
      context: { source: "knowledgeBase.openSourceManager" },
    })
    expect(migrationService.getStorageStatus).toHaveBeenCalled()
  })

  it("blocks source manager opening when knowledge base storage is unavailable", async () => {
    const { harness, migrationService } = createHarness({ service: {} })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Missing/Synapse",
      knowledgeBasesPath: "/Volumes/Missing/Synapse/knowledge-bases",
      available: false,
      unavailableReason: "missing volume",
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:open_source_manager", {
      projectId: "project-1",
      projectName: "知识库001",
    })).rejects.toThrow("知识库存储位置不可用。请在设置中重新检测。")

    expect(sourceManagerWindowServiceMock.open).not.toHaveBeenCalled()
  })

  it("starts storage migration through a guarded write operation", async () => {
    const { auditSink, harness, migrationService, permissionGuard } = createHarness({ service: {} })
    migrationService.startMigration.mockResolvedValue({ status: "completed" })

    await harness.invoke("synapse:app:knowledge_base:operation:start_storage_migration", {
      target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
    })

    expect(migrationService.startMigration).toHaveBeenCalledWith({
      target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
      requestedBy: "settings",
    })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/Volumes/Data/SynapseData",
      context: { source: "knowledgeBase.startStorageMigration" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      outcome: "allowed",
      resource: "/Volumes/Data/SynapseData",
      metadata: { source: "knowledgeBase.startStorageMigration" },
    }))
  })

  it("guards the old custom storage path when restoring storage to default", async () => {
    const { auditSink, harness, migrationService, permissionGuard } = createHarness({ service: {} })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
      knowledgeBasesPath: "/Volumes/Data/SynapseData/knowledge-bases",
      available: true,
    })
    migrationService.startMigration.mockResolvedValue({ status: "completed" })

    await harness.invoke("synapse:app:knowledge_base:operation:start_storage_migration", {
      target: { mode: "default" },
    })

    expect(migrationService.startMigration).toHaveBeenCalledWith({
      target: { mode: "default" },
      requestedBy: "settings",
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/Volumes/Data/SynapseData/knowledge-bases",
      context: { source: "knowledgeBase.startStorageMigration.oldCustomStorage.read" },
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/Volumes/Data/SynapseData/knowledge-bases",
      context: { source: "knowledgeBase.startStorageMigration.oldCustomStorage.write" },
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(3, expect.objectContaining({
      action: "fs.write",
      resource: "managed-knowledge-base:default-storage",
      context: { source: "knowledgeBase.startStorageMigration" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/Volumes/Data/SynapseData/knowledge-bases",
      metadata: { source: "knowledgeBase.startStorageMigration.oldCustomStorage.read" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      outcome: "allowed",
      resource: "/Volumes/Data/SynapseData/knowledge-bases",
      metadata: { source: "knowledgeBase.startStorageMigration.oldCustomStorage.write" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "managed-knowledge-base:default-storage",
      metadata: { source: "knowledgeBase.startStorageMigration" },
    }))
  })

  it("returns current storage status", async () => {
    const { harness, migrationService } = createHarness({ service: {} })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "default",
      rootPath: "/tmp/userData",
      knowledgeBasesPath: "/tmp/userData/knowledge-bases",
      available: true,
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:get_storage_status", undefined))
      .resolves.toMatchObject({
        mode: "default",
        available: true,
      })
  })

  it("returns current storage migration state", async () => {
    const { harness, migrationService } = createHarness({ service: {} })
    migrationService.getState.mockReturnValue({
      active: true,
      phase: "copying",
      cancellable: true,
      progress: {
        copiedBytes: 12,
        totalBytes: 24,
      },
      message: "正在复制知识库",
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:get_storage_migration_state", undefined))
      .resolves.toMatchObject({
        active: true,
        phase: "copying",
        copiedBytes: 12,
      })
  })

  it("lists raw directory entries through guarded read permission", async () => {
    const listRawDirectory = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      directoryPath: "client-a",
      entries: [{
        name: "brief.md",
        relativePath: "client-a/brief.md",
        kind: "file",
        size: 12,
        modifiedAt: "2026-05-24T00:00:00.000Z",
      }],
    })
    const { harness, permissionGuard } = createHarness({ service: { listRawDirectory } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:list_raw_directory", {
      projectId: "kb-1",
      directoryPath: "client-a",
    }) as { entries: unknown[] }

    expect(listRawDirectory).toHaveBeenCalledWith({
      projectId: "kb-1",
      directoryPath: "client-a",
    })
    expect(result.entries).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.listRawDirectory" },
    })
  })

  it("blocks raw directory listing during storage migration", async () => {
    const listRawDirectory = vi.fn().mockResolvedValue({ projectId: "kb-1", directoryPath: "", entries: [] })
    const { harness } = createHarness({ migrationActive: true, service: { listRawDirectory } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:list_raw_directory", {
      projectId: "kb-1",
      directoryPath: "",
    })).rejects.toThrow("知识库存储迁移正在进行")

    expect(listRawDirectory).not.toHaveBeenCalled()
  })

  it("uploads raw files through guarded read and write permissions", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [{
        name: "brief.md",
        relativePath: "client-a/brief.md",
        kind: "file",
        size: 12,
        modifiedAt: "2026-05-24T00:00:00.000Z",
      }],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadRawFiles } })

    await harness.invoke("synapse:app:knowledge_base:operation:upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      filePaths: ["/tmp/brief.md"],
    })

    expect(uploadRawFiles).toHaveBeenCalledWith({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      filePaths: ["/tmp/brief.md"],
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/brief.md",
      context: { source: "knowledgeBase.uploadRawFiles.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.uploadRawFiles" },
    })
  })

  it("returns invalid-name raw upload skips without failing response validation", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [{ path: "/tmp/CON.txt", reason: "invalid-name" }],
    })
    const { harness } = createHarness({ service: { uploadRawFiles } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "",
      filePaths: ["/tmp/CON.txt"],
    })).resolves.toEqual({
      projectId: "kb-1",
      entries: [],
      skipped: [{ path: "/tmp/CON.txt", reason: "invalid-name" }],
    })
  })

  it("selects raw files into the requested folder through guarded read and write permissions", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadRawFiles } })

    await harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(electronMock.focusedWindow, expect.objectContaining({
      properties: ["openFile", "multiSelections"],
    }))
    expect(uploadRawFiles).toHaveBeenCalledWith({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      filePaths: ["/tmp/source.md"],
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/source.md",
      context: { source: "knowledgeBase.selectAndUploadRawFiles.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.selectAndUploadRawFiles" },
    })
  })

  it("blocks selected raw file upload before opening picker when storage is unavailable", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { harness, migrationService, permissionGuard } = createHarness({ service: { uploadRawFiles } })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Missing/Synapse",
      knowledgeBasesPath: "/Volumes/Missing/Synapse/knowledge-bases",
      available: false,
      unavailableReason: "missing volume",
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })).rejects.toThrow("知识库存储位置不可用。请在设置中重新检测。")

    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(uploadRawFiles).not.toHaveBeenCalled()
  })

  it("blocks selected raw file upload during storage migration before opening picker", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { harness, migrationService, permissionGuard } = createHarness({ migrationActive: true, service: { uploadRawFiles } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })).rejects.toThrow("知识库存储迁移正在进行，请稍后再试。")

    expect(migrationService.getStorageStatus).not.toHaveBeenCalled()
    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(uploadRawFiles).not.toHaveBeenCalled()
  })

  it("does not upload raw files when external file read permission is denied", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { auditSink, harness, permissionGuard } = createHarness({
      permissions: [{ allowed: false, reason: "denied by test", policyId: "test-policy" }],
      service: { uploadRawFiles },
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      filePaths: ["/tmp/brief.md"],
    })).rejects.toThrow("denied by test")

    expect(uploadRawFiles).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledOnce()
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/brief.md",
      outcome: "denied",
      metadata: {
        source: "knowledgeBase.uploadRawFiles.read",
        reason: "denied by test",
        policyId: "test-policy",
      },
    })
  })

  it("blocks direct raw file upload during storage migration before permission checks", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ migrationActive: true, service: { uploadRawFiles } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:upload_raw_files", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      filePaths: ["/tmp/brief.md"],
    })).rejects.toThrow("知识库存储迁移正在进行，请稍后再试。")

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(uploadRawFiles).not.toHaveBeenCalled()
  })

  it("uploads raw items through guarded external read and managed write permissions", async () => {
    const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, permissionGuard } = createHarness({ service: { uploadRawItems } })

    await harness.invoke("synapse:app:knowledge_base:operation:upload_raw_items", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      itemPaths: ["/tmp/folder"],
    })

    expect(uploadRawItems).toHaveBeenCalledWith({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      itemPaths: ["/tmp/folder"],
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/folder",
      context: { source: "knowledgeBase.uploadRawItems.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.uploadRawItems" },
    })
  })

  it("selects one raw directory into the requested folder", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/folder"] })
    const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness } = createHarness({ service: { uploadRawItems } })

    await harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_directory", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openDirectory"],
    }))
    expect(uploadRawItems).toHaveBeenCalledWith({
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
      itemPaths: ["/tmp/folder"],
    })
  })

  it("blocks selected raw directory upload before opening picker when storage is unavailable", async () => {
    const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, migrationService, permissionGuard } = createHarness({ service: { uploadRawItems } })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Missing/Synapse",
      knowledgeBasesPath: "/Volumes/Missing/Synapse/knowledge-bases",
      available: false,
      unavailableReason: "missing volume",
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_directory", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })).rejects.toThrow("知识库存储位置不可用。请在设置中重新检测。")

    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(uploadRawItems).not.toHaveBeenCalled()
  })

  it("blocks selected raw directory upload during storage migration before opening picker", async () => {
    const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, migrationService, permissionGuard } = createHarness({ migrationActive: true, service: { uploadRawItems } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:select_and_upload_raw_directory", {
      projectId: "kb-1",
      targetDirectoryPath: "client-a",
    })).rejects.toThrow("知识库存储迁移正在进行，请稍后再试。")

    expect(migrationService.getStorageStatus).not.toHaveBeenCalled()
    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(uploadRawItems).not.toHaveBeenCalled()
  })

  it("exports raw entries to a selected external directory", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/export"] })
    const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, permissionGuard } = createHarness({ service: { exportRawEntries } })

    await harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md", "folder"],
    })

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openDirectory", "createDirectory"],
    }))
    expect(exportRawEntries).toHaveBeenCalledWith({
      projectId: "kb-1",
      relativePaths: ["brief.md", "folder"],
      targetDirectoryPath: "/tmp/export",
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.exportRawEntries.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/export",
      context: { source: "knowledgeBase.exportRawEntries.write" },
    })
  })

  it("tracks raw export as a source manager operation", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/export"] })
    const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness } = createHarness({ service: { exportRawEntries } })

    await harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })

    expect(sourceManagerWindowServiceMock.trackMutation).toHaveBeenCalledTimes(1)
    expect(exportRawEntries).toHaveBeenCalledWith({
      projectId: "kb-1",
      relativePaths: ["brief.md"],
      targetDirectoryPath: "/tmp/export",
    })
  })

  it("blocks raw export before opening picker when storage is unavailable", async () => {
    const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, migrationService, permissionGuard } = createHarness({ service: { exportRawEntries } })
    migrationService.getStorageStatus.mockResolvedValue({
      mode: "custom",
      rootPath: "/Volumes/Missing/Synapse",
      knowledgeBasesPath: "/Volumes/Missing/Synapse/knowledge-bases",
      available: false,
      unavailableReason: "missing volume",
    })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })).rejects.toThrow("知识库存储位置不可用。请在设置中重新检测。")

    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(exportRawEntries).not.toHaveBeenCalled()
  })

  it("blocks raw export while storage migration blocks source manager operations", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/export"] })
    sourceManagerWindowServiceMock.trackMutation.mockRejectedValueOnce(new Error("知识库存储迁移正在进行。"))
    const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness } = createHarness({ service: { exportRawEntries } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })).rejects.toThrow("知识库存储迁移正在进行")

    expect(exportRawEntries).not.toHaveBeenCalled()
  })

  it("returns an empty export result when directory selection is canceled", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const exportRawEntries = vi.fn()
    const { harness } = createHarness({ service: { exportRawEntries } })

    const result = await harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })

    expect(exportRawEntries).not.toHaveBeenCalled()
    expect(result).toEqual({ projectId: "kb-1", entries: [], skipped: [] })
  })

  it("rejects oversized raw export selections before opening the target directory picker", async () => {
    const exportRawEntries = vi.fn()
    const { harness } = createHarness({ service: { exportRawEntries } })

    await expect(harness.invoke("synapse:app:knowledge_base:operation:export_raw_entries", {
      projectId: "kb-1",
      relativePaths: Array.from(
        { length: KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES + 1 },
        (_, index) => `entry-${index}.md`,
      ),
    })).rejects.toThrow()

    expect(electronMock.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(exportRawEntries).not.toHaveBeenCalled()
  })

  it("mutates raw entries through guarded write permission", async () => {
    const createRawFolder = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const renameRawEntry = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const moveRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const trashRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { auditSink, harness, permissionGuard } = createHarness({
      service: { createRawFolder, renameRawEntry, moveRawEntries, trashRawEntries },
    })

    await harness.invoke("synapse:app:knowledge_base:operation:create_raw_folder", {
      projectId: "kb-1",
      parentDirectoryPath: "",
      name: "client-a",
    })
    await harness.invoke("synapse:app:knowledge_base:operation:rename_raw_entry", {
      projectId: "kb-1",
      relativePath: "brief.md",
      newName: "brief-renamed.md",
    })
    await harness.invoke("synapse:app:knowledge_base:operation:move_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["brief-renamed.md"],
      targetDirectoryPath: "client-a",
    })
    await harness.invoke("synapse:app:knowledge_base:operation:trash_raw_entries", {
      projectId: "kb-1",
      relativePaths: ["client-a/brief-renamed.md"],
    })

    expect(createRawFolder).toHaveBeenCalledWith({
      projectId: "kb-1",
      parentDirectoryPath: "",
      name: "client-a",
    })
    expect(renameRawEntry).toHaveBeenCalledWith({
      projectId: "kb-1",
      relativePath: "brief.md",
      newName: "brief-renamed.md",
    })
    expect(moveRawEntries).toHaveBeenCalledWith({
      projectId: "kb-1",
      relativePaths: ["brief-renamed.md"],
      targetDirectoryPath: "client-a",
    })
    expect(trashRawEntries).toHaveBeenCalledWith({
      projectId: "kb-1",
      relativePaths: ["client-a/brief-renamed.md"],
    })
    expect(permissionGuard.check).toHaveBeenCalledTimes(4)
    expect(permissionGuard.check).toHaveBeenLastCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.trashRawEntries" },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "managed-knowledge-base:kb-1",
      metadata: expect.objectContaining({
        source: "knowledgeBase.renameRawEntry",
        rawNewName: "brief-renamed.md",
        rawRelativePaths: ["brief.md"],
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "managed-knowledge-base:kb-1",
      metadata: expect.objectContaining({
        source: "knowledgeBase.moveRawEntries",
        rawRelativePaths: ["brief-renamed.md"],
        rawTargetDirectoryPath: "client-a",
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "managed-knowledge-base:kb-1",
      metadata: expect.objectContaining({
        source: "knowledgeBase.trashRawEntries",
        rawRelativePaths: ["client-a/brief-renamed.md"],
      }),
    }))
  })

})

function createHarness(options: {
  migrationActive?: boolean
  permissions?: Awaited<ReturnType<PermissionGuard["check"]>>[]
  service: unknown
}) {
  const harness = createInMemoryHarness()
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(),
  }
  for (const permission of options.permissions ?? [{ allowed: true }]) {
    vi.mocked(permissionGuard.check).mockResolvedValueOnce(permission)
  }
  vi.mocked(permissionGuard.check).mockResolvedValue({ allowed: true })
  const auditSink: AuditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const migrationService = {
    cancelMigration: vi.fn(),
    getState: vi.fn<() => KnowledgeBaseStorageMigrationState>(() => ({
      active: false,
      phase: "idle",
      cancellable: false,
      progress: {
        copiedBytes: 0,
        totalBytes: null,
      },
      message: "",
    })),
    getStorageStatus: vi.fn<() => Promise<SynapseKnowledgeBaseStorageStatus>>(async () => ({
      mode: "default" as const,
      rootPath: "/tmp/userData",
      knowledgeBasesPath: "/tmp/userData/knowledge-bases",
      available: true,
    })),
    isActive: vi.fn(() => options.migrationActive ?? false),
    startMigration: vi.fn(),
  }
  harness.registry.register(knowledgeBaseIpcModule, {
    moduleId: "knowledge-base",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "knowledge-base.service") return options.service as T
      if (serviceId === "knowledge-base.storage-migration-service") return migrationService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })
  return { auditSink, harness, migrationService, permissionGuard }
}
