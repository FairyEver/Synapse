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

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { KnowledgeBaseService } from "../../../services/knowledge-base/knowledge-base-service"
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
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(electronMock.focusedWindow)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    electronMock.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/source.md"] })
    sourceManagerWindowServiceMock.open.mockResolvedValue(undefined)
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

    const result = await harness.invoke("synapse:knowledge-base:create-managed", {
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

    await expect(harness.invoke("synapse:knowledge-base:create-managed", {
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

  it("deletes a managed knowledge base through guarded write permission", async () => {
    const deleteManaged = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      runtimePath: "/UserData/knowledge-bases/kb-1",
      deleted: true,
    })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { deleteManaged } })

    const result = await harness.invoke("synapse:knowledge-base:delete-managed", {
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

  it("lists source files through guarded read permission", async () => {
    const listSources = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      sources: [{
        relativePath: "2026/05/23/source.md",
        name: "source.md",
        size: 12,
        modifiedAt: "2026-05-23T00:00:00.000Z",
        supported: true,
        status: "pending",
        hash: "abc",
      }],
    })
    const { harness, permissionGuard } = createHarness({ service: { listSources } })

    const result = await harness.invoke("synapse:knowledge-base:list-sources", {
      projectId: "kb-1",
    }) as { sources: unknown[] }

    expect(listSources).toHaveBeenCalledWith("kb-1")
    expect(result.sources).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.listSources" },
    })
  })

  it("uploads selected source files through guarded read and write permissions", async () => {
    const uploadSources = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      uploaded: [{
        originalPath: "/tmp/source.md",
        relativePath: "2026/05/23/source.md",
        originalRelativePath: "_attachments/originals/2026/05/23/source.docx",
        name: "source.md",
        size: 12,
        conversionWarnings: [{ code: "presentation_structure_limited", message: "Limited structure" }],
      }],
      skipped: [{ path: "/tmp/broken.docx", reason: "conversion-error" }],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadSources } })

    const result = await harness.invoke("synapse:knowledge-base:select-and-upload-sources", {
      projectId: "kb-1",
    }) as { uploaded: unknown[] }

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(electronMock.focusedWindow, expect.objectContaining({
      properties: ["openFile", "multiSelections"],
    }))
    expect(uploadSources).toHaveBeenCalledWith({
      projectId: "kb-1",
      filePaths: ["/tmp/source.md"],
    })
    expect(result.uploaded).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/source.md",
      context: { source: "knowledgeBase.selectAndUploadSources.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.selectAndUploadSources" },
    })
  })

  it("uploads dropped source files through guarded read and write permissions", async () => {
    const uploadSources = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      uploaded: [],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadSources } })

    await harness.invoke("synapse:knowledge-base:upload-sources", {
      projectId: "kb-1",
      filePaths: ["/tmp/source.md"],
    })

    expect(uploadSources).toHaveBeenCalledWith({
      projectId: "kb-1",
      filePaths: ["/tmp/source.md"],
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/source.md",
      context: { source: "knowledgeBase.uploadSources.read" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "managed-knowledge-base:kb-1",
      context: { source: "knowledgeBase.uploadSources" },
    })
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

    const result = await harness.invoke("synapse:knowledge-base:add-url-source", {
      projectId: "kb-1",
      url: "https://example.com/article?token=secret-token",
    }) as { uploaded: unknown[] }

    expect(addUrlSource).toHaveBeenCalledWith({
      projectId: "kb-1",
      url: "https://example.com/article?token=secret-token",
    })
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

    const result = await harness.invoke("synapse:knowledge-base:add-url-source", {
      projectId: "kb-1",
      url: "https://example.com/missing",
    }) as { skipped: Array<{ reason: string }> }

    expect(result.skipped).toEqual([{
      path: "https://example.com/missing",
      reason: "network_error",
    }])
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

    await expect(harness.invoke("synapse:knowledge-base:add-url-source", {
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
          themeMode: "system",
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
          variables: [],
          quickInputs: [],
          defaultQuickInputsSeededVersion: null,
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
        agent: { defaultPermissionMode: "default", defaultProviderModel: null },
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

    const result = await harness.invoke("synapse:knowledge-base:add-url-source", {
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
    const { harness, permissionGuard } = createHarness({ service: {} })

    await harness.invoke("synapse:knowledge-base:open-source-manager", {
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

    const result = await harness.invoke("synapse:knowledge-base:list-raw-directory", {
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

    await harness.invoke("synapse:knowledge-base:upload-raw-files", {
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

  it("selects raw files into the requested folder through guarded read and write permissions", async () => {
    const uploadRawFiles = vi.fn().mockResolvedValue({
      projectId: "kb-1",
      entries: [],
      skipped: [],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadRawFiles } })

    await harness.invoke("synapse:knowledge-base:select-and-upload-raw-files", {
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

    await expect(harness.invoke("synapse:knowledge-base:upload-raw-files", {
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

  it("uploads raw items through guarded external read and managed write permissions", async () => {
    const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, permissionGuard } = createHarness({ service: { uploadRawItems } })

    await harness.invoke("synapse:knowledge-base:upload-raw-items", {
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

    await harness.invoke("synapse:knowledge-base:select-and-upload-raw-directory", {
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

  it("exports raw entries to a selected external directory", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/export"] })
    const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { harness, permissionGuard } = createHarness({ service: { exportRawEntries } })

    await harness.invoke("synapse:knowledge-base:export-raw-entries", {
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
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/export",
      context: { source: "knowledgeBase.exportRawEntries.write" },
    })
  })

  it("returns an empty export result when directory selection is canceled", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const exportRawEntries = vi.fn()
    const { harness } = createHarness({ service: { exportRawEntries } })

    const result = await harness.invoke("synapse:knowledge-base:export-raw-entries", {
      projectId: "kb-1",
      relativePaths: ["brief.md"],
    })

    expect(exportRawEntries).not.toHaveBeenCalled()
    expect(result).toEqual({ projectId: "kb-1", entries: [], skipped: [] })
  })

  it("mutates raw entries through guarded write permission", async () => {
    const createRawFolder = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const renameRawEntry = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const moveRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const trashRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
    const { auditSink, harness, permissionGuard } = createHarness({
      service: { createRawFolder, renameRawEntry, moveRawEntries, trashRawEntries },
    })

    await harness.invoke("synapse:knowledge-base:create-raw-folder", {
      projectId: "kb-1",
      parentDirectoryPath: "",
      name: "client-a",
    })
    await harness.invoke("synapse:knowledge-base:rename-raw-entry", {
      projectId: "kb-1",
      relativePath: "brief.md",
      newName: "brief-renamed.md",
    })
    await harness.invoke("synapse:knowledge-base:move-raw-entries", {
      projectId: "kb-1",
      relativePaths: ["brief-renamed.md"],
      targetDirectoryPath: "client-a",
    })
    await harness.invoke("synapse:knowledge-base:trash-raw-entries", {
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
  harness.registry.register(knowledgeBaseIpcModule, {
    moduleId: "knowledge-base",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "knowledge-base.service") return options.service as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })
  return { auditSink, harness, permissionGuard }
}
