import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => "/tmp/synapse-agent-ipc-test"),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn<() => { id: number } | undefined>(() => undefined),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  clipboard: {
    readImage: vi.fn<() => { isEmpty: () => boolean; toPNG: () => Buffer }>(() => ({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0),
    })),
  },
}))

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { AgentAttachmentQuotaError } from "../../../services/agent-runtime/attachment-staging-service"
import { AGENT_CONVERSATION_WINDOW_SERVICE_ID } from "../../../services/agent-conversation-window-service"
import { defaultKnowledgeBaseUserDataPath } from "../../../services/knowledge-base/managed-path"
import { PROVIDER_SERVICE_ID } from "../../../services/provider"
import { agentIpcModule } from "../ipc"
import { configStore } from "../../../services/config-store"
import { createConversationHistory183 } from "./fixtures/conversation-history-183"
import type { SynapseAgentAttachmentSelectionResult } from "../../../../src/types/bridge"

vi.mock("../../../services/agent-runtime/binary-detect-service", () => ({
  whichBin: vi.fn().mockResolvedValue(null),
}))

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command: string, _args: readonly string[], callback: (error: Error | null) => void) => {
    callback(new Error("missing"))
  }),
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

vi.mock("electron", () => electronMock)

describe("agentIpcModule", () => {
  beforeEach(() => {
    logStoreMock.logger.warn.mockClear()
    electronMock.BrowserWindow.getFocusedWindow.mockReset()
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(undefined)
    electronMock.dialog.showOpenDialog.mockReset()
    electronMock.dialog.showSaveDialog.mockReset()
    electronMock.clipboard.readImage.mockReset()
    electronMock.clipboard.readImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0),
    })
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
      },
    } as never)
  })

  it("declares stable workspace file tree channels", () => {
    expect(agentIpcModule.methods.openWorkspaceTree.operationId).toBe("app.agent.workspace_tree.open")
    expect(agentIpcModule.methods.listWorkspaceTree.operationId).toBe("app.agent.workspace_tree.list")
    expect(agentIpcModule.methods.resolveWorkspaceTreePaths.operationId).toBe("app.agent.workspace_tree.resolve_paths")
    expect(agentIpcModule.methods.closeWorkspaceTree.operationId).toBe("app.agent.workspace_tree.close")
    expect(agentIpcModule.events.workspaceTreeChanged.operationId).toBe("app.agent.workspace_tree.changed")
  })

  it("chooses multiple files and converts supported images into visual attachments", async () => {
    const root = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-choose-files-"))
    const imagePath = path.join(root, "screen.png")
    const filePath = path.join(root, "brief.md")
    await fs.writeFile(imagePath, Buffer.from([1, 2, 3]))
    await fs.writeFile(filePath, "content")
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [imagePath, filePath],
    })

    try {
      const result = await createHarness({}).invoke(
        "synapse:app:agent:operation:choose_attachments",
        { projectId: "project-1", draftScopeId: "draft-1", kind: "file" },
      ) as SynapseAgentAttachmentSelectionResult

      expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith({
        title: "添加文件",
        properties: ["openFile", "multiSelections"],
      })
      expect(result).toMatchObject({
        rejectedCount: 0,
        attachments: [
          {
            sourceIndex: 0,
            ref: expect.objectContaining({ kind: "image", name: "screen.png" }),
          },
          {
            sourceIndex: 1,
            ref: expect.objectContaining({ kind: "file", name: "brief.md" }),
          },
        ],
      })
      const imageAttachment = result.attachments[0]
      expect(imageAttachment?.ref.kind).toBe("image")
      expect(JSON.stringify(result)).not.toMatch(/"(?:data|bytes|base64)":/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("chooses multiple folders and keeps the dialog attached to the focused window", async () => {
    const root = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-choose-folders-"))
    const first = path.join(root, "first")
    const second = path.join(root, "second")
    await fs.mkdir(first)
    await fs.mkdir(second)
    const focusedWindow = { id: 1 }
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValueOnce(focusedWindow)
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [first, second],
    })

    try {
      const result = await createHarness({}).invoke(
        "synapse:app:agent:operation:choose_attachments",
        { projectId: "project-1", draftScopeId: "draft-1", kind: "directory" },
      ) as SynapseAgentAttachmentSelectionResult

      expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(focusedWindow, {
        title: "添加文件夹",
        properties: ["openDirectory", "multiSelections"],
      })
      expect(result.attachments).toEqual([
        expect.objectContaining({ sourceIndex: 0, ref: expect.objectContaining({ kind: "directory", name: "first" }) }),
        expect.objectContaining({ sourceIndex: 1, ref: expect.objectContaining({ kind: "directory", name: "second" }) }),
      ])
      expect(JSON.stringify(result)).not.toContain(root)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("leaves attachment selection empty when the native picker is cancelled", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    })

    await expect(createHarness({}).invoke(
      "synapse:app:agent:operation:choose_attachments",
      { projectId: "project-1", draftScopeId: "draft-1", kind: "file" },
    )).resolves.toEqual({ attachments: [], rejectedCount: 0 })
  })

  it("resolves path attachment types and rejects missing paths and symbolic links independently", async () => {
    const root = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-resolve-paths-"))
    const emptyFile = path.join(root, "empty")
    const emptyImage = path.join(root, "empty.png")
    const directory = path.join(root, "materials")
    const link = path.join(root, "materials-link")
    await fs.writeFile(emptyFile, "")
    await fs.writeFile(emptyImage, "")
    await fs.mkdir(directory)
    await fs.symlink(directory, link, "dir")

    try {
      const result = await createHarness({}).invoke(
        "synapse:app:agent:operation:resolve_attachment_paths",
        { projectId: "project-1", draftScopeId: "draft-1", paths: [emptyFile, path.join(root, "missing"), directory, link, emptyImage] },
      )

      expect(result).toEqual({
        attachments: [
          expect.objectContaining({ sourceIndex: 0, ref: expect.objectContaining({ kind: "file" }) }),
          expect.objectContaining({ sourceIndex: 2, ref: expect.objectContaining({ kind: "directory", name: "materials" }) }),
        ],
        rejectedCount: 3,
      })
      expect(JSON.stringify(result)).not.toContain(directory)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("rolls back attachments staged by one path request when that request exceeds quota", async () => {
    const firstRef = testImageRef("image-1", "image-1.png")
    const stageAttachmentPaths = vi.fn()
      .mockResolvedValueOnce([{ ref: firstRef }])
      .mockRejectedValueOnce(new AgentAttachmentQuotaError("图片附件最多 50 张。"))
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)

    await expect(createHarness({
      agent: { releaseAttachments, stageAttachmentPaths },
    }).invoke(
      "synapse:app:agent:operation:resolve_attachment_paths",
      {
        projectId: "project-1",
        draftScopeId: "draft-1",
        paths: ["/tmp/image-1.png", "/tmp/image-2.png"],
      },
    )).resolves.toEqual({ attachments: [], rejectedCount: 2 })
    expect(releaseAttachments).toHaveBeenCalledWith({
      actor: { kind: "user", id: "renderer" },
      draftScopeId: "draft-1",
      attachmentIds: ["image-1"],
    })
  })

  it("stages a clipboard image through the Agent attachment service", async () => {
    const ref = testImageRef("clipboard-1", "paste.png")
    const stageAttachmentBytes = vi.fn().mockResolvedValue([{ ref }])
    electronMock.clipboard.readImage.mockReturnValueOnce({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
    })

    await expect(createHarness({ agent: { stageAttachmentBytes } }).invoke(
      "synapse:app:agent:operation:stage_clipboard_image",
      { projectId: "project-1", draftScopeId: "draft-1", name: "paste.png" },
    )).resolves.toEqual({
      attachments: [{ sourceIndex: 0, ref }],
      rejectedCount: 0,
    })
    expect(stageAttachmentBytes).toHaveBeenCalledWith(expect.objectContaining({
      draftScopeId: "draft-1",
      attachments: [expect.objectContaining({ name: "paste.png", mimeType: "image/png" })],
    }))
  })

  it("rejects empty clipboard images and invalid staging requests", async () => {
    const stageAttachmentBytes = vi.fn()
    const harness = createHarness({ agent: { stageAttachmentBytes } })

    await expect(harness.invoke(
      "synapse:app:agent:operation:stage_clipboard_image",
      { projectId: "project-1", draftScopeId: "draft-1" },
    )).resolves.toEqual({ attachments: [], rejectedCount: 1 })
    expect(stageAttachmentBytes).not.toHaveBeenCalled()
    await expect(harness.invoke(
      "synapse:app:agent:operation:stage_clipboard_image",
      { projectId: "project-1", draftScopeId: "" },
    )).rejects.toThrow()
  })

  it("propagates clipboard staging and attachment release failures", async () => {
    electronMock.clipboard.readImage.mockReturnValueOnce({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
    })
    const stagingFailure = new Error("staging failed")
    await expect(createHarness({
      agent: { stageAttachmentBytes: vi.fn().mockRejectedValue(stagingFailure) },
    }).invoke(
      "synapse:app:agent:operation:stage_clipboard_image",
      { projectId: "project-1", draftScopeId: "draft-1" },
    )).rejects.toThrow(stagingFailure)

    const releaseFailure = new Error("release failed")
    await expect(createHarness({
      agent: { releaseAttachments: vi.fn().mockRejectedValue(releaseFailure) },
    }).invoke(
      "synapse:app:agent:operation:release_attachments",
      { projectId: "project-1", draftScopeId: "draft-1", attachmentIds: ["attachment-1"] },
    )).rejects.toThrow(releaseFailure)
  })

  it("opens the project container and sends local renderer messages through AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
      agentSessionId: "thread-1",
      threadId: "thread-1",
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "hello",
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      content: "hello",
      replyCtx: {
        kind: "local-renderer",
        projectId: "project-1",
        sessionKey: "local:renderer",
      },
    }))
    expect(result).toEqual({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
      agentSessionId: "thread-1",
      threadId: "thread-1",
      error: undefined,
    })
  })

  it("opens managed knowledge base projects with their configured hidden runtime path", async () => {
    const customRoot = path.join(tmpdir(), "synapse-agent-ipc-custom-kb-root")
    const backingPath = path.join(customRoot, "knowledge-bases", "kb-1")
    await fs.rm(backingPath, { recursive: true, force: true })
    await fs.mkdir(backingPath, { recursive: true })
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        knowledgeBaseStorage: { mode: "custom", rootPath: customRoot },
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
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
      },
    } as never)
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "kb-1",
      content: "hello",
    })

    expect(harness.projectContainers.open).toHaveBeenCalledWith("kb-1", {
      name: "Knowledge",
      workspacePath: backingPath,
      managedKnowledgeBase: true,
    })
  })

  it("rejects managed knowledge base projects when their hidden runtime path is missing", async () => {
    const runtimeId = "missing-kb-agent-ipc-test"
    const backingPath = path.join(defaultKnowledgeBaseUserDataPath(), "knowledge-bases", runtimeId)
    await fs.rm(backingPath, { recursive: true, force: true })
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        projects: [{
          id: "kb-missing",
          name: "Knowledge",
          path: `synapse-kb://${runtimeId}`,
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId,
            },
          },
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
      },
    } as never)
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "kb-missing",
      content: "hello",
    })).rejects.toThrow("知识库运行目录不存在")

    expect(harness.projectContainers.open).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Managed knowledge base workspace unavailable.",
      expect.objectContaining({
        boundary: "agent.managed-knowledge-base.workspace",
        projectId: "kb-missing",
        projectName: "Knowledge",
        errorCode: "ENOENT",
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain(backingPath)
  })

  it("blocks managed knowledge base conversation sends during storage migration", async () => {
    const customRoot = path.join(tmpdir(), "synapse-agent-ipc-migration-kb-root")
    const backingPath = path.join(customRoot, "knowledge-bases", "kb-1")
    await fs.rm(backingPath, { recursive: true, force: true })
    await fs.mkdir(backingPath, { recursive: true })
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        knowledgeBaseStorage: { mode: "custom", rootPath: customRoot },
        projects: [{
          id: "kb-1",
          name: "Knowledge",
          path: "synapse-kb://kb-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              managed: true,
              runtimeId: "kb-1",
            },
          },
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
      },
    } as never)
    const send = vi.fn()
    const sendToConversation = vi.fn()
    const storageMigration = { isActive: vi.fn(() => true) }
    const harness = createHarness({
      agent: { send, sendToConversation },
      storageMigration,
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "kb-1",
      conversationId: "conv-1",
      content: "hello",
    })).rejects.toThrow("知识库存储迁移正在进行")

    expect(storageMigration.isActive).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(sendToConversation).not.toHaveBeenCalled()
    expect(harness.projectContainers.open).not.toHaveBeenCalled()
  })

  it("allows ordinary project sends while knowledge base storage migration is active", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [],
    })
    const storageMigration = { isActive: vi.fn(() => true) }
    const harness = createHarness({
      agent: { send },
      storageMigration,
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "hello",
    })).resolves.toEqual(expect.objectContaining({
      conversationId: "conv-1",
      resultText: "done",
    }))

    expect(storageMigration.isActive).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalled()
  })

  it("passes optional providerId through local renderer sends", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "hello",
      providerId: "deepseek",
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "deepseek",
    }))
  })

  it("resolves ordered attachment ids before forwarding trusted refs", async () => {
    const imageRef = testImageRef("image-1", "chart.png")
    const fileRef = {
      version: 2 as const,
      attachmentId: "file-1",
      kind: "file" as const,
      name: "report.md",
      byteSize: 6,
      sha256: "1".repeat(64),
    }
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
        resolveStagedAttachments: vi.fn().mockResolvedValue({
          draftScopeId: "draft-1",
          refs: [imageRef, fileRef],
        }),
      },
    })

    await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "hello",
      displayContent: "hello",
      attachments: [
        { attachmentId: "file-1", order: 1 },
        { attachmentId: "image-1", order: 0 },
      ],
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      attachmentRefs: [imageRef, fileRef],
      attachmentDraftScopeId: "draft-1",
      displayContent: "hello",
    }))
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/"(?:data|bytes|base64)":/)
  })

  it("blocks missing path attachments before sending to AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "",
      attachments: [{
        kind: "path",
        path: path.join(await fs.realpath(tmpdir()), "synapse-agent-missing-attachment.md"),
        entryType: "file",
      }],
    })).rejects.toThrow("Validation failed")

    expect(send).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === "win32")("blocks symlink path attachments before sending to AgentRuntime", async () => {
    const root = await fs.mkdtemp(path.join(await fs.realpath(tmpdir()), "synapse-agent-attachments-"))
    const realPath = path.join(root, "real.md")
    const linkPath = path.join(root, "linked.md")
    await fs.writeFile(realPath, "real")
    await fs.symlink(realPath, linkPath)
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    try {
      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "",
        attachments: [{
          kind: "path",
          path: linkPath,
          entryType: "file",
        }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === "win32")("blocks path attachments that traverse symlinked directories", async () => {
    const realTmpDir = await fs.realpath(tmpdir())
    const root = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-"))
    const outside = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-outside-"))
    const outsideFilePath = path.join(outside, "secret.md")
    const linkDirectoryPath = path.join(root, "linked-dir")
    await fs.writeFile(outsideFilePath, "secret")
    await fs.symlink(outside, linkDirectoryPath, "dir")
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    try {
      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "",
        attachments: [{
          kind: "path",
          path: path.join(linkDirectoryPath, "secret.md"),
          entryType: "file",
        }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === "win32")("blocks directory attachments that contain symlinks", async () => {
    const realTmpDir = await fs.realpath(tmpdir())
    const root = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-"))
    const outside = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-outside-"))
    const nested = path.join(root, "nested")
    const outsideFilePath = path.join(outside, "secret.md")
    await fs.mkdir(nested)
    await fs.writeFile(outsideFilePath, "secret")
    await fs.symlink(outsideFilePath, path.join(nested, "linked-secret.md"))
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    try {
      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "",
        attachments: [{
          kind: "path",
          path: root,
          entryType: "directory",
        }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === "win32")("blocks directory attachments with symlinks inside dependency directories", async () => {
    const realTmpDir = await fs.realpath(tmpdir())
    const root = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-"))
    const outside = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-outside-"))
    const nodeModules = path.join(root, "node_modules")
    await fs.mkdir(nodeModules)
    await fs.writeFile(path.join(root, "package.json"), "{}")
    await fs.writeFile(path.join(outside, "secret.md"), "secret")
    await fs.symlink(outside, path.join(nodeModules, "private-package"), "dir")
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    try {
      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "read this project",
        attachments: [{
          kind: "path",
          path: root,
          entryType: "directory",
        }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks too many path attachments before scanning files", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({ agent: { send } })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "read these files",
      attachments: Array.from({ length: 21 }, (_, index) => ({
        kind: "path",
        path: `/missing-${index}`,
        entryType: "file",
      })),
    })).rejects.toThrow("Validation failed")

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks directory attachments that exceed the aggregate scan entry budget", async () => {
    const realTmpDir = await fs.realpath(tmpdir())
    const root = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-wide-"))
    const send = vi.fn()
    const harness = createHarness({ agent: { send } })

    try {
      for (let offset = 0; offset < 4_097; offset += 256) {
        const count = Math.min(256, 4_097 - offset)
        await Promise.all(Array.from({ length: count }, (_, index) => (
          fs.mkdir(path.join(root, `entry-${offset + index}`))
        )))
      }

      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "read this directory",
        attachments: [{ kind: "path", path: root, entryType: "directory" }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks directory attachments that exceed the scan depth limit", async () => {
    const realTmpDir = await fs.realpath(tmpdir())
    const root = await fs.mkdtemp(path.join(realTmpDir, "synapse-agent-attachments-deep-"))
    const send = vi.fn()
    const harness = createHarness({ agent: { send } })

    try {
      let current = root
      for (let depth = 0; depth < 66; depth += 1) {
        current = path.join(current, "nested")
        await fs.mkdir(current)
      }

      await expect(harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "read this directory",
        attachments: [{ kind: "path", path: root, entryType: "directory" }],
      })).rejects.toThrow("Validation failed")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks oversized image attachments before sending to AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "",
      attachments: [{
        kind: "image",
        mimeType: "image/png",
        data: new Uint8Array((10 * 1024 * 1024) + 1),
      }],
    })).rejects.toThrow("Validation failed")

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks too many image attachments before sending to AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "",
      attachments: Array.from({ length: 9 }, () => ({
        kind: "image",
        mimeType: "image/png",
        data: new Uint8Array([1]),
      })),
    })).rejects.toThrow("Validation failed")

    expect(send).not.toHaveBeenCalled()
  })

  it("blocks aggregate image attachment bytes before sending to AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array(10 * 1024 * 1024),
        },
        {
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array(10 * 1024 * 1024),
        },
        {
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1]),
        },
      ],
    })).rejects.toThrow("Validation failed")

    expect(send).not.toHaveBeenCalled()
  })

  it("allows 50 ordered attachment references without raw image bytes", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "",
      attachments: Array.from({ length: 50 }, (_, order) => ({
        attachmentId: `image-${order}`,
        order,
      })),
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      attachmentRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "image", attachmentId: "image-49" }),
      ]),
    }))
  })

  it("validates SDK events in local renderer send responses", async () => {
    const sdkEvents = [
      {
        type: "sessionInit",
        sdkSessionId: "sdk-1",
        tools: ["Read"],
        model: "claude-sonnet-4-5",
        payload: { type: "system", subtype: "init" },
      },
      {
        type: "assistant",
        sdkSessionId: "sdk-1",
        message: {
          content: [{ type: "text", text: "hello" }],
        },
        payload: { type: "assistant" },
      },
      {
        type: "stream",
        sdkSessionId: "sdk-1",
        event: {
          delta: { text: "hello" },
        },
        payload: { type: "stream_event" },
      },
      {
        type: "status",
        sdkSessionId: "sdk-1",
        status: "running",
        payload: { type: "system", subtype: "status" },
      },
      {
        type: "compactBoundary",
        sdkSessionId: "sdk-1",
        payload: { type: "system", subtype: "compact_boundary" },
      },
      {
        type: "sdkEvent",
        sdkSessionId: "sdk-1",
        sdkType: "system",
        sdkSubtype: "unknown",
        payload: { type: "system", secret: "not-rendered-here" },
      },
      {
        type: "toolUse",
        sdkSessionId: "sdk-1",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        toolInput: "{\"file_path\":\"README.md\"}",
      },
      {
        type: "toolResult",
        sdkSessionId: "sdk-1",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        content: "file content",
        status: "success",
        success: true,
      },
      {
        type: "result",
        content: "",
        done: true,
        sdkSessionId: "sdk-1",
        usage: { inputTokens: 1, outputTokens: 2 },
        costUsd: 0.01,
        payload: { type: "result" },
      },
    ]
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "",
      events: sdkEvents,
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:send", {
      projectId: "project-1",
      content: "hello",
    })

    expect(result).toEqual(expect.objectContaining({
      events: sdkEvents,
    }))
  })

  it("preserves tool use ids and image artifacts in conversation timelines", async () => {
    const imageArtifacts = [{
      id: "artifact-1",
      kind: "image" as const,
      mimeType: "image/png" as const,
      byteSize: 76,
      url: "synapse-agent-artifact://local/project/conv/artifact-1.png",
      sha256: "sha256-artifact-1",
    }]
    const getSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-1",
      sessionKey: "local:renderer",
      active: true,
      history: [
        {
          role: "tool",
          content: "Read\n{\"file_path\":\"README.md\"}",
          timestamp: "2026-04-27T03:17:00.000Z",
          metadata: {
            agentEventType: "toolUse",
            toolUseId: "toolu-read-1",
            toolName: "Read",
          },
        },
        {
          role: "tool",
          content: "file content",
          timestamp: "2026-04-27T03:17:01.000Z",
          metadata: {
            agentEventType: "toolResult",
            toolUseId: "toolu-read-1",
            toolName: "Read",
            status: "success",
            success: true,
            imageArtifacts,
          },
        },
      ],
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    })
    const harness = createHarness({
      agent: {
        getSession,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-1",
    }) as {
      readonly entries: readonly {
        readonly toolUseId?: string
        readonly imageArtifacts?: readonly typeof imageArtifacts[number][]
      }[]
    }

    expect(result.entries).toEqual([
      expect.objectContaining({
        kind: "toolCall",
        toolUseId: "toolu-read-1",
        toolName: "Read",
      }),
      expect.objectContaining({
        kind: "toolResult",
        toolUseId: "toolu-read-1",
        toolName: "Read",
        imageArtifacts,
      }),
    ])
  })

  it("returns success false when conversation bundle export is cancelled", async () => {
    electronMock.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    const conversation = {
      id: "conv-1",
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "local:renderer",
      providerId: "anthropic",
      agentType: "claude-code",
      history: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }
    const harness = createHarness({
      dataRepository: {
        namespace: vi.fn((name: string) => ({
          name,
          schemaVersion: 1,
          backend: "sqlite",
          get: vi.fn(async (id: string) => name === "conversations" && id === conversation.id ? conversation : null),
          getSingleton: vi.fn().mockResolvedValue(null),
          setSingleton: vi.fn().mockResolvedValue(undefined),
          list: vi.fn().mockResolvedValue([]),
          upsert: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          onChange: vi.fn(() => () => {}),
        })),
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:export_conversation_bundle", {
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: "local:renderer",
    })

    expect(result).toEqual({ success: false })
    expect(harness.dataRepository.namespace).toHaveBeenCalledWith("agent.artifacts")
    expect(electronMock.dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "导出对话",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    }))
  })

  it("returns provider summaries without secrets", async () => {
    const listProviders = vi.fn().mockResolvedValue([{
      id: "anthropic",
      name: "Anthropic",
      category: "official",
      active: true,
      model: "claude-sonnet-4.5",
      baseUrl: "https://api.anthropic.example.test",
      apiKeyField: "ANTHROPIC_API_KEY",
      secretRef: "secret:anthropic",
      env: { ANTHROPIC_API_KEY: "sk-secret" },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }])
    const getActiveProvider = vi.fn().mockResolvedValue({
      id: "anthropic",
      name: "Anthropic",
      category: "official",
      active: true,
      model: "claude-sonnet-4.5",
      baseUrl: "https://api.anthropic.example.test",
      apiKeyField: "ANTHROPIC_API_KEY",
      secretRef: "secret:anthropic",
      env: { ANTHROPIC_API_KEY: "sk-secret" },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    })
    const harness = createHarness({
      providerService: {
        listProviders,
        getActiveProvider,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_providers", {
      projectId: "project-1",
    })

    expect(result).toEqual({
      agentType: "claude-code",
      activeProviderId: "anthropic",
      activeModel: "claude-sonnet-4.5",
      providers: [{
        id: "anthropic",
        display: "Anthropic",
        active: true,
        model: "claude-sonnet-4.5",
        baseUrl: "https://api.anthropic.example.test",
        scope: "global",
      }],
    })
    expect(listProviders).toHaveBeenCalled()
    expect(getActiveProvider).toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).not.toContain("secret:anthropic")
    expect(JSON.stringify(result)).not.toContain("secretRef")
  })

  it("exposes provider CRUD IPC without returning secrets", async () => {
    const provider = {
      id: "anthropic",
      name: "Anthropic",
      category: "official",
      active: true,
      model: "claude-sonnet-4.5",
      baseUrl: "https://api.anthropic.example.test",
      apiKeyField: "ANTHROPIC_API_KEY",
      secretRef: "secret:anthropic",
      env: { ANTHROPIC_API_KEY: "sk-secret" },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }
    const listProviders = vi.fn().mockResolvedValue([provider])
    const createProvider = vi.fn().mockResolvedValue(provider)
    const updateProvider = vi.fn().mockResolvedValue({ ...provider, name: "Anthropic Updated" })
    const archiveProvider = vi.fn().mockResolvedValue(undefined)
    const setActiveProvider = vi.fn().mockResolvedValue(undefined)
    const harness = createHarness({
      providerService: {
        listProviders,
        createProvider,
        updateProvider,
        archiveProvider,
        setActiveProvider,
      },
    })

    const listResult = await harness.invoke("synapse:app:agent:operation:list_providers", {
      projectId: "project-1",
    })
    const createResult = await harness.invoke("synapse:app:agent:operation:create_provider", {
      projectId: "project-1",
      provider: {
        id: "anthropic",
        name: "Anthropic",
        category: "official",
        baseUrl: "https://api.anthropic.example.test",
        apiKeyField: "ANTHROPIC_API_KEY",
        apiKey: "sk-secret",
        active: true,
        model: "claude-sonnet-4.5",
        env: {
          ANTHROPIC_API_KEY: "unsafe",
          NODE_OPTIONS: "--require unsafe",
          PATH: "/tmp/unsafe",
        },
        secretRef: "secret:unsafe",
        encryptedApiKey: "encrypted-unsafe",
        encryptedSecret: "encrypted-secret",
      },
    })
    const updateResult = await harness.invoke("synapse:app:agent:operation:update_provider", {
      projectId: "project-1",
      providerId: "anthropic",
      patch: {
        name: "Anthropic Updated",
        apiKey: "sk-new-secret",
        env: {
          ANTHROPIC_AUTH_TOKEN: "unsafe",
          NODE_OPTIONS: "--require unsafe",
        },
        secretRef: "secret:update-unsafe",
        encryptedApiKey: "encrypted-update-unsafe",
        encryptedSecret: "encrypted-update-secret",
      },
    })
    const archiveResult = await harness.invoke("synapse:app:agent:operation:archive_provider", {
      projectId: "project-1",
      providerId: "anthropic",
    })
    const activeResult = await harness.invoke("synapse:app:agent:operation:set_active_provider", {
      projectId: "project-1",
      providerId: "anthropic",
    })

    expect(listResult).toEqual([expect.objectContaining({ id: "anthropic", name: "Anthropic" })])
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-secret" }))
    expect(updateProvider).toHaveBeenCalledWith("anthropic", expect.objectContaining({ apiKey: "sk-new-secret" }))
    const createProviderInput = createProvider.mock.calls[0]?.[0] as Record<string, unknown>
    const updateProviderPatch = updateProvider.mock.calls[0]?.[1] as Record<string, unknown>
    for (const input of [createProviderInput, updateProviderPatch]) {
      expect(input).not.toHaveProperty("env")
      expect(input).not.toHaveProperty("secretRef")
      expect(input).not.toHaveProperty("encryptedApiKey")
      expect(input).not.toHaveProperty("encryptedSecret")
    }
    expect(archiveProvider).toHaveBeenCalledWith("anthropic")
    expect(setActiveProvider).toHaveBeenCalledWith("anthropic")
    expect(archiveResult).toEqual({ ok: true })
    expect(activeResult).toEqual({ ok: true })
    for (const result of [listResult, createResult, updateResult]) {
      expect(JSON.stringify(result)).not.toContain("sk-secret")
      expect(JSON.stringify(result)).not.toContain("sk-new-secret")
      expect(JSON.stringify(result)).not.toContain("secret:anthropic")
      expect(JSON.stringify(result)).not.toContain("secretRef")
      const providers = Array.isArray(result) ? result : [result]
      for (const providerResult of providers) {
        expect(providerResult).not.toHaveProperty("apiKey")
        expect(providerResult).not.toHaveProperty("env")
      }
    }
  })

  it("lists provider presets through IPC without secrets", async () => {
    const listProviderPresets = vi.fn().mockResolvedValue([{
      name: "PackyCode",
      category: "third_party",
      websiteUrl: "https://www.packyapi.com",
      apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: undefined,
      templateValues: [],
    }])
    const harness = createHarness({
      providerService: {
        listProviderPresets,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:list_provider_presets", {})

    expect(listProviderPresets).toHaveBeenCalled()
    expect(result).toEqual([expect.objectContaining({
      name: "PackyCode",
      baseUrl: "https://www.packyapi.com",
    })])
    expect(JSON.stringify(result)).not.toContain("sk-")
  })

  it("creates a provider from a preset through IPC", async () => {
    const createProviderFromPreset = vi.fn().mockResolvedValue({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      active: false,
      env: {},
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })
    const harness = createHarness({
      providerService: {
        createProviderFromPreset,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:create_provider_from_preset", {
      presetName: "PackyCode",
      apiKey: "sk-packy",
    })

    expect(createProviderFromPreset).toHaveBeenCalledWith({
      presetName: "PackyCode",
      apiKey: "sk-packy",
    })
    expect(result).toEqual(expect.objectContaining({
      id: "packycode",
      name: "PackyCode",
    }))
    expect(JSON.stringify(result)).not.toContain("sk-packy")
  })

  it("previews and imports CC Switch Claude providers through IPC without secrets", async () => {
    const source = { kind: "sqlite" as const, path: "/Users/test/.cc-switch/cc-switch.db" }
    const previewCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      source,
      items: [{
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        status: "ready",
        selectedByDefault: true,
      }],
    })
    const importCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      imported: [{
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      }],
      skipped: [],
    })
    const harness = createHarness({
      providerService: {
        previewCcSwitchClaudeProviders,
        importCcSwitchClaudeProviders,
      },
    })

    const preview = await harness.invoke("synapse:app:agent:operation:preview_cc_switch_claude_providers", {})
    const result = await harness.invoke("synapse:app:agent:operation:import_cc_switch_claude_providers", {
      source,
      providerIds: ["deepseek"],
    })

    expect(previewCcSwitchClaudeProviders).toHaveBeenCalledWith(undefined, {
      actor: { kind: "user", id: "renderer" },
    })
    expect(importCcSwitchClaudeProviders).toHaveBeenCalledWith({
      source,
      providerIds: ["deepseek"],
    }, {
      actor: { kind: "user", id: "renderer" },
    })
    expect(result).toEqual({
      imported: [expect.objectContaining({ id: "deepseek" })],
      skipped: [],
    })
    expect(JSON.stringify(preview)).not.toContain("sk-")
    expect(JSON.stringify(result)).not.toContain("sk-")
  })

  it("previews, imports, and exports provider packages through IPC without returning secrets", async () => {
    const previewProviderPackageImport = vi.fn().mockResolvedValue({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
      contentSha256: "a".repeat(64),
      packageVersion: 1,
      sourceProviderId: "deepseek",
      targetProviderId: "deepseek-2",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: "deepseek-chat",
    })
    const importProviderPackage = vi.fn().mockResolvedValue({
      provider: {
        id: "deepseek-2",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        env: {},
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
    })
    const exportProviderPackage = vi.fn().mockResolvedValue({
      filePath: "/Users/test/deepseek.synapse-provider.json",
    })
    const harness = createHarness({
      providerService: {
        previewProviderPackageImport,
        importProviderPackage,
        exportProviderPackage,
      },
    })

    const preview = await harness.invoke("synapse:app:agent:operation:preview_provider_package_import", {
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
    })
    const imported = await harness.invoke("synapse:app:agent:operation:import_provider_package", {
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
      contentSha256: "a".repeat(64),
    })
    const exported = await harness.invoke("synapse:app:agent:operation:export_provider_package", {
      providerId: "deepseek",
      targetPath: "/Users/test/deepseek.synapse-provider.json",
    })

    expect(previewProviderPackageImport).toHaveBeenCalledWith("/Users/test/deepseek.synapse-provider.json", {
      actor: { kind: "user", id: "renderer" },
    })
    expect(importProviderPackage).toHaveBeenCalledWith(
      "/Users/test/deepseek.synapse-provider.json",
      { contentSha256: "a".repeat(64) },
      { actor: { kind: "user", id: "renderer" } },
    )
    expect(exportProviderPackage).toHaveBeenCalledWith("deepseek", "/Users/test/deepseek.synapse-provider.json", {
      actor: { kind: "user", id: "renderer" },
    })
    expect(preview).toEqual(expect.objectContaining({ targetProviderId: "deepseek-2" }))
    expect(imported).toEqual({ provider: expect.objectContaining({ id: "deepseek-2" }) })
    expect(exported).toEqual({ filePath: "/Users/test/deepseek.synapse-provider.json" })
    expect(JSON.stringify({ preview, imported, exported })).not.toContain("sk-")
  })

  it("uses Windows-safe default file names when exporting provider packages", async () => {
    electronMock.dialog.showSaveDialog.mockResolvedValue({ canceled: true })
    const harness = createHarness({})

    const cases = [
      { providerName: "CON", expectedDefaultPath: "_CON.synapse-provider.json" },
      { providerName: "NUL", expectedDefaultPath: "_NUL.synapse-provider.json" },
      { providerName: "COM1", expectedDefaultPath: "_COM1.synapse-provider.json" },
      { providerName: "Provider:One. ", expectedDefaultPath: "Provider_One.synapse-provider.json" },
    ]

    for (const item of cases) {
      await expect(harness.invoke("synapse:app:agent:operation:choose_provider_package_export_target", {
        providerName: item.providerName,
      })).resolves.toEqual({})
    }

    expect(electronMock.dialog.showSaveDialog).toHaveBeenCalledTimes(cases.length)
    for (const [index, item] of cases.entries()) {
      expect(electronMock.dialog.showSaveDialog).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        defaultPath: item.expectedDefaultPath,
      }))
    }
  })

  it("returns Agent runtime readiness without exposing secrets", async () => {
    const harness = createHarness({
      providerService: {
        listProviders: vi.fn().mockResolvedValue([{
          id: "anthropic",
          name: "Anthropic",
          category: "official",
          active: true,
          model: "claude-sonnet-4.5",
          baseUrl: "https://api.example.test",
          apiKeyField: "ANTHROPIC_API_KEY",
          secretRef: "secret:anthropic",
          env: { ANTHROPIC_API_KEY: "sk-secret" },
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        }]),
        getActiveProvider: vi.fn().mockResolvedValue({
          id: "anthropic",
          name: "Anthropic",
          category: "official",
          active: true,
          model: "claude-sonnet-4.5",
          baseUrl: "https://api.example.test",
          apiKeyField: "ANTHROPIC_API_KEY",
          secretRef: "secret:anthropic",
          env: { ANTHROPIC_API_KEY: "sk-secret" },
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        }),
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_runtime_status", {
      projectId: "project-1",
    }) as {
      readonly agents: readonly {
        readonly id: string
        readonly ready: boolean
        readonly issues: readonly string[]
        readonly provider?: {
          readonly configured: boolean
          readonly activeProviderId?: string
          readonly activeModel?: string
        }
      }[]
    }

    expect(result.agents.map((agent) => agent.id)).toEqual(["claude-code"])
    expect(result.agents.find((agent) => agent.id === "claude-code")).toEqual(expect.objectContaining({
      ready: expect.any(Boolean),
      provider: {
        activeProviderId: "anthropic",
        activeModel: "claude-sonnet-4.5",
        configured: true,
        projectId: "project-1",
      },
    }))
    expect(JSON.stringify(result)).not.toContain("secret:anthropic")
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).not.toContain("secretRef")
  })

  it("does not report missing system claude as a runtime issue", async () => {
    const harness = createHarness({
      providerService: {
        listProviders: vi.fn().mockResolvedValue([]),
        getActiveProvider: vi.fn().mockResolvedValue(null),
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_runtime_status", {
      projectId: "project-1",
    }) as {
      readonly agents: readonly {
        readonly cli: { readonly required: boolean; readonly installed: boolean; readonly path: string | null }
        readonly issues: readonly string[]
      }[]
    }

    const claude = result.agents.find((agent) => agent.issues.includes("provider-not-configured"))
    expect(claude?.issues).not.toContain("cli-not-installed")
    expect(claude?.cli).toEqual({
      required: false,
      installed: true,
      path: null,
    })
  })

  it("does not mark an agent provider as unconfigured when matching providers exist", async () => {
    const harness = createHarness({
      providerService: {
        listProviders: vi.fn().mockResolvedValue([{
          id: "anthropic",
          name: "Anthropic",
          category: "official",
          active: true,
          model: "claude-sonnet-4.5",
          baseUrl: "https://api.anthropic.example.test",
          apiKeyField: "ANTHROPIC_API_KEY",
          secretRef: "secret:anthropic",
          env: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        }]),
        getActiveProvider: vi.fn().mockResolvedValue({
          id: "anthropic",
          name: "Anthropic",
          category: "official",
          active: true,
          model: "claude-sonnet-4.5",
          baseUrl: "https://api.anthropic.example.test",
          apiKeyField: "ANTHROPIC_API_KEY",
          secretRef: "secret:anthropic",
          env: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        }),
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_runtime_status", {
      projectId: "project-1",
    }) as {
      readonly agents: readonly {
        readonly id: string
        readonly issues: readonly string[]
        readonly provider?: {
          readonly configured: boolean
          readonly activeProviderId?: string
          readonly activeModel?: string
        }
      }[]
    }

    const claude = result.agents.find((agent) => agent.id === "claude-code")

    expect(claude?.issues).not.toContain("provider-not-configured")
    expect(claude?.provider).toEqual({
      activeProviderId: "anthropic",
      activeModel: "claude-sonnet-4.5",
      configured: true,
      projectId: "project-1",
    })
  })

  it("returns the full conversation timeline when no limit is requested", async () => {
    const history = Array.from({ length: 101 }, (_, index) => ({
      role: "user" as const,
      content: `message ${String(index + 1)}`,
      timestamp: `2026-04-27T03:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }))
    const getSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-1",
      sessionKey: "local:renderer",
      active: true,
      history,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    })
    const harness = createHarness({
      agent: {
        getSession,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-1",
    }) as {
      readonly entries: readonly { readonly content: string }[]
      readonly total: number
      readonly startIndex: number
      readonly hasMore: boolean
    }

    expect(result.entries).toHaveLength(101)
    expect(result).toEqual(expect.objectContaining({
      total: 101,
      startIndex: 0,
      hasMore: false,
    }))
    expect(result.entries[0]).toEqual(expect.objectContaining({
      content: "message 1",
    }))
  })

  it("pages 183 history records at complete user turn boundaries", async () => {
    const history = createConversationHistory183()
    const getSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-183",
      sessionKey: "local:renderer",
      active: true,
      history,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:01.000Z",
    })
    const harness = createHarness({ agent: { getSession } })

    const latest = await harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-183",
      limit: 100,
    }) as {
      readonly entries: readonly { readonly id: string; readonly kind: string }[]
      readonly total: number
      readonly startIndex: number
      readonly hasMore: boolean
    }

    expect(latest).toEqual(expect.objectContaining({
      total: 183,
      startIndex: 3,
      hasMore: true,
    }))
    expect(latest.entries).toHaveLength(180)
    expect(latest.entries.find((entry) => entry.id.endsWith(":history:82"))?.kind).toBe("toolCall")
    expect(latest.entries.find((entry) => entry.id.endsWith(":history:83"))?.kind).toBe("toolResult")

    const older = await harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-183",
      limit: 100,
      beforeIndex: latest.startIndex,
    }) as {
      readonly entries: readonly { readonly id: string }[]
      readonly total: number
      readonly startIndex: number
      readonly hasMore: boolean
    }

    expect(older).toEqual(expect.objectContaining({
      total: 183,
      startIndex: 0,
      hasMore: false,
    }))
    expect(older.entries.map((entry) => entry.id)).toEqual([
      "conv-183:history:0",
      "conv-183:history:1",
      "conv-183:history:2",
    ])
  })

  it("allows a single user turn to exceed the requested page size", async () => {
    const history = Array.from({ length: 125 }, (_, index) => ({
      role: index === 0 ? "user" as const : "assistant" as const,
      content: `entry ${String(index)}`,
      timestamp: new Date(Date.UTC(2026, 7, 3, 0, 0, 0, index)).toISOString(),
      ...(index === 0 ? {} : { metadata: { agentEventType: "thinking" } }),
    }))
    const harness = createHarness({
      agent: {
        getSession: vi.fn().mockResolvedValue({
          projectId: "project-1",
          id: "conv-long-turn",
          sessionKey: "local:renderer",
          active: true,
          history,
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:01.000Z",
        }),
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-long-turn",
      limit: 100,
    }) as { readonly entries: readonly unknown[]; readonly startIndex: number; readonly hasMore: boolean }

    expect(result.entries).toHaveLength(125)
    expect(result.startIndex).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it("returns empty pagination metadata for an empty conversation", async () => {
    const harness = createHarness({
      agent: {
        getSession: vi.fn().mockResolvedValue({
          projectId: "project-1",
          id: "conv-empty",
          sessionKey: "local:renderer",
          active: true,
          history: [],
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:01.000Z",
        }),
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-empty",
      limit: 100,
    })).resolves.toEqual(expect.objectContaining({
      entries: [],
      total: 0,
      startIndex: 0,
      hasMore: false,
    }))
  })

  it("rejects a beforeIndex that splits a persisted turn", async () => {
    const harness = createHarness({
      agent: {
        getSession: vi.fn().mockResolvedValue({
          projectId: "project-1",
          id: "conv-183",
          sessionKey: "local:renderer",
          active: true,
          history: createConversationHistory183(),
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:01.000Z",
        }),
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      conversationId: "conv-183",
      limit: 100,
      beforeIndex: 83,
    })).rejects.toThrow("Invalid conversation history boundary: 83")
  })

  it("logs timeline runtime fallback with sanitized correlation context", async () => {
    const rawError = Object.assign(
      new Error("runtime timeline unavailable for /Users/example/project; prompt: deploy secret-token"),
      { code: "SDK_TIMELINE_FAILED" },
    )
    const listSessions = vi.fn().mockRejectedValue(rawError)
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:app:agent:operation:get_timeline", {
      projectId: "project-1",
      sessionKey: "local:renderer",
      limit: 10,
    })).rejects.toThrow("找不到当前项目")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent timeline runtime lookup failed; trying repository fallback.",
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "[redacted]",
        hasConversationId: false,
        limit: 10,
        boundary: "agent.timeline.runtime",
        errorName: "Error",
        errorCode: "SDK_TIMELINE_FAILED",
        errorLength: rawError.message.length,
      }),
    )
    const details = logStoreMock.logger.warn.mock.calls[0]?.[1] as Record<string, unknown>
    expect(JSON.stringify(details)).not.toContain("/Users/example/project")
    expect(JSON.stringify(details)).not.toContain("deploy secret-token")
    expect(JSON.stringify(details)).not.toContain("local:renderer")
  })

  it("returns readable source labels for external sessions", async () => {
    const listSessions = vi.fn().mockResolvedValue([{
      projectId: "project-1",
      id: "external-conv",
      sessionKey: "external:group:user",
      platform: "external",
      channelKey: "external:group",
      active: true,
      history: [],
      userMeta: {
        userName: "User One",
        chatName: "Dev Group",
      },
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    }])
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:app:agent:operation:list_sessions", {
      projectId: "project-1",
    })).resolves.toEqual([
      expect.objectContaining({
        projectId: "project-1",
        id: "external-conv",
        platform: "external",
        sourceLabel: "Dev Group / User One",
      }),
    ])
  })

  it("loads bounded archived session summaries without full histories", async () => {
    const listWindow = vi.fn().mockResolvedValue([{
      value: {
        projectId: "archived-project",
        id: "archived-conv",
        schemaVersion: 1,
        sessionKey: "local:renderer",
        active: false,
        history: [{ role: "assistant", content: "latest", timestamp: "2026-07-15T02:00:00.000Z" }],
        createdAt: "2026-07-15T01:00:00.000Z",
        updatedAt: "2026-07-15T02:00:00.000Z",
      },
      arrayLength: 42,
    }])
    const harness = createHarness({
      dataRepository: {
        namespace: vi.fn(() => ({ listWindow })),
      },
    })

    await expect(harness.invoke("synapse:app:agent:operation:list_all_sessions", {
      excludeProjectIds: ["project-1"],
      limit: 25,
    })).resolves.toEqual([expect.objectContaining({
      projectId: "archived-project",
      id: "archived-conv",
      historyCount: 42,
      lastMessage: expect.objectContaining({
        id: "archived-conv:history:41",
        content: "latest",
      }),
    })])
    expect(listWindow).toHaveBeenCalledWith({
      exclude: { projectId: ["project-1"] },
      orderBy: "updatedAt",
      order: "desc",
      limit: 25,
      arrayTail: "history",
    })
  })

  it("opens AgentRuntime for configured project ids used by external sessions", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "repo-1",
        name: "Repository One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [{
          id: "project-1",
          name: "Project One",
          path: "/repo",
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const listSessions = vi.fn().mockResolvedValue([{
      projectId: "project-1",
      id: "external-conv",
      sessionKey: "external:group:user",
      platform: "external",
      active: true,
      history: [],
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    }])
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:app:agent:operation:list_sessions", {
      projectId: "project-1",
    })).resolves.toEqual([
      expect.objectContaining({
        projectId: "project-1",
        id: "external-conv",
        platform: "external",
      }),
    ])
    expect(harness.projectContainers.open).toHaveBeenCalledWith("project-1", {
      name: "Project One",
      workspacePath: "/repo",
    })
  })

  it("creates and switches local renderer sessions", async () => {
    const created = {
      projectId: "project-1",
      id: "conv-2",
      sessionKey: "local:renderer",
      name: "新会话",
      platform: "local-renderer",
      providerId: "deepseek",
      active: true,
      history: [],
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    }
    const createSession = vi.fn().mockResolvedValue(created)
    const switchSession = vi.fn().mockResolvedValue({
      ...created,
      id: "conv-1",
      name: "旧会话",
    })
    const deleteSession = vi.fn().mockResolvedValue(true)
    const harness = createHarness({
      agent: {
        createSession,
        switchSession,
        deleteSession,
      },
    })

    expect(await harness.invoke("synapse:app:agent:operation:create_session", {
      projectId: "project-1",
      name: "新会话",
      providerId: "deepseek",
    })).toEqual(expect.objectContaining({
      projectId: "project-1",
      id: "conv-2",
      sessionKey: "local:renderer",
      name: "新会话",
      providerId: "deepseek",
      active: true,
      historyCount: 0,
    }))
    expect(createSession).toHaveBeenCalledWith({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "新会话",
      agentType: "claude-code",
      providerId: "deepseek",
      mode: "default",
    })

    const bypassSession = {
      ...created,
      id: "conv-bypass",
      agentConfig: { mode: "bypassPermissions" },
    }
    createSession.mockResolvedValueOnce(bypassSession)

    expect(await harness.invoke("synapse:app:agent:operation:create_session", {
      projectId: "project-1",
      mode: "bypassPermissions",
    })).toEqual(expect.objectContaining({
      id: "conv-bypass",
      mode: "bypassPermissions",
    }))
    expect(createSession).toHaveBeenLastCalledWith({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: undefined,
      agentType: "claude-code",
      providerId: undefined,
      mode: "bypassPermissions",
    })

    expect(await harness.invoke("synapse:app:agent:operation:switch_session", {
      projectId: "project-1",
      conversationId: "conv-1",
    })).toEqual(expect.objectContaining({
      projectId: "project-1",
      id: "conv-1",
      sessionKey: "local:renderer",
      name: "旧会话",
      providerId: "deepseek",
      active: true,
      historyCount: 0,
    }))
    expect(switchSession).toHaveBeenCalledWith(
      "local:renderer",
      "conv-1",
    )

    expect(await harness.invoke("synapse:app:agent:operation:delete_session", {
      projectId: "project-1",
      conversationId: "conv-1",
    })).toEqual({ ok: true })
    expect(deleteSession).toHaveBeenCalledWith("conv-1")
  })

  it("uses global default permission mode when create-session mode is omitted", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "plan",
      },
    } as never)
    const createSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-default-bypass",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      active: true,
      history: [],
      agentConfig: { mode: "plan" },
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const harness = createHarness({ agent: { createSession } })

    await harness.invoke("synapse:app:agent:operation:create_session", {
      projectId: "project-1",
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: "plan",
    }))
  })

  it("lets explicit create-session mode override the global default permission mode", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "bypassPermissions",
      },
    } as never)
    const createSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-plan",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      active: true,
      history: [],
      agentConfig: { mode: "plan" },
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const harness = createHarness({ agent: { createSession } })

    await harness.invoke("synapse:app:agent:operation:create_session", {
      projectId: "project-1",
      mode: "plan",
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: "plan",
    }))
  })

  it("sets conversation permission mode through IPC", async () => {
    const setPermissionMode = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:renderer",
      agentConfig: { mode: "plan" },
      active: true,
      history: [],
      schemaVersion: 1,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })
    const harness = createHarness({
      agent: {
        setPermissionMode,
      },
    })

    const result = await harness.invoke("synapse:app:agent:operation:set_permission_mode", {
      projectId: "project-1",
      conversationId: "conversation-1",
      mode: "plan",
    })

    expect(setPermissionMode).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      mode: "plan",
      actor: { kind: "user" },
    })
    expect(result).toMatchObject({
      id: "conversation-1",
      mode: "plan",
    })
  })

  describe("phase emit (Plan A)", () => {
    it("emits submitted (done) + received (in-progress) + received (done) + completed (done) on success", async () => {
      const send = vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        resultText: "ok",
        events: [],
      })
      const harness = createHarness({ agent: { send } })

      const past = new Date(Date.now() - 100).toISOString()
      await harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "hi",
        clientSubmittedAt: past,
      })

      const phases = harness.eventBusEmits
        .filter((e) => e.type === "phase.update")
        .map((e) => {
          const payload = e.payload as { phase: string; status: string }
          return { phase: payload.phase, status: payload.status }
        })

      expect(phases).toEqual([
        { phase: "submitted", status: "done" },
        { phase: "received", status: "in-progress" },
        { phase: "received", status: "done" },
        { phase: "completed", status: "done" },
      ])
    })

    it("emits cancelled instead of failed when a user-stopped turn settles with an error", async () => {
      const send = vi.fn().mockResolvedValue({
        conversationId: "conv-cancelled",
        resultText: "",
        error: "已停止本次执行。",
        events: [{
          type: "result",
          content: "",
          done: true,
          metadata: { cancelled: true },
        }],
      })
      const harness = createHarness({ agent: { send } })

      await harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "stop me",
      })

      const phases = harness.eventBusEmits
        .filter((event) => event.type === "phase.update")
        .map((event) => {
          const payload = event.payload as { phase: string; status: string; errorMessage?: string }
          return { phase: payload.phase, status: payload.status, errorMessage: payload.errorMessage }
        })

      expect(phases).toEqual([
        { phase: "submitted", status: "done", errorMessage: undefined },
        { phase: "received", status: "in-progress", errorMessage: undefined },
        { phase: "received", status: "done", errorMessage: undefined },
        { phase: "cancelled", status: "done", errorMessage: undefined },
      ])
    })

    it("routes sends with a conversation id to that conversation", async () => {
      const send = vi.fn()
      const sendToConversation = vi.fn().mockResolvedValue({
        conversationId: "conv-queued",
        resultText: "ok",
        events: [],
      })
      const harness = createHarness({ agent: { send, sendToConversation } })

      await harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conv-queued",
        content: "queued",
      })

      expect(send).not.toHaveBeenCalled()
      expect(sendToConversation).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:renderer",
        content: "queued",
      }), "conv-queued")
    })

    it("clamps a client clock that is ahead of the server", async () => {
      const send = vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        resultText: "ok",
        events: [],
      })
      const harness = createHarness({ agent: { send } })

      const future = new Date(Date.now() + 5_000).toISOString()
      await harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "hi",
        clientSubmittedAt: future,
      })

      const submitted = harness.eventBusEmits.find(
        (e) => e.type === "phase.update" && (e.payload as { phase: string }).phase === "submitted",
      )
      expect(submitted).toBeDefined()
      // Clamped: startedAt is NOT the future timestamp.
      expect((submitted!.payload as { startedAt: string }).startedAt).not.toBe(future)
    })

    it("falls back to t_recv when clientSubmittedAt is older than 60s", async () => {
      const send = vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        resultText: "ok",
        events: [],
      })
      const harness = createHarness({ agent: { send } })

      const stale = new Date(Date.now() - 120_000).toISOString()
      await harness.invoke("synapse:app:agent:operation:send", {
        projectId: "project-1",
        content: "hi",
        clientSubmittedAt: stale,
      })

      const submitted = harness.eventBusEmits.find(
        (e) => e.type === "phase.update" && (e.payload as { phase: string }).phase === "submitted",
      )
      expect((submitted!.payload as { startedAt: string }).startedAt).not.toBe(stale)
    })

    it("emits a sanitized failed phase and diagnostic when agent.send throws", async () => {
      const rawError = Object.assign(
        new Error("SDK failed for /Users/example/repo with token=sk-secret and prompt text"),
        { code: "SDK_SEND_FAILED" },
      )
      const send = vi.fn().mockImplementation(async () => {
        throw rawError
      })
      const harness = createHarness({ agent: { send } })

      await expect(
        harness.invoke("synapse:app:agent:operation:send", {
          projectId: "project-1",
          content: "hi",
          providerId: "anthropic",
        }),
      ).rejects.toThrow(rawError.message)

      const failed = harness.eventBusEmits.find(
        (e) => e.type === "phase.update" && (e.payload as { phase: string }).phase === "failed",
      )
      expect(failed).toBeDefined()
      expect((failed!.payload as { errorMessage: string }).errorMessage).toBe("发送失败")
      expect(JSON.stringify(failed!.payload)).not.toContain("/Users/example/repo")
      expect(JSON.stringify(failed!.payload)).not.toContain("sk-secret")
      expect(JSON.stringify(failed!.payload)).not.toContain("prompt text")
      expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
        "Agent send IPC failed.",
        expect.objectContaining({
          projectId: "project-1",
          sessionKey: "local:renderer",
          providerId: "anthropic",
          boundary: "agent.send.ipc",
          errorName: "Error",
          errorCode: "SDK_SEND_FAILED",
          errorLength: rawError.message.length,
        }),
      )
      expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("/Users/example/repo")
      expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("sk-secret")
      expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("prompt text")
    })

    it("emits a failed phase when project agent resolution fails", async () => {
      vi.mocked(configStore.load).mockResolvedValueOnce({
        repositories: [],
        global: {
          themeMode: "system",
          projects: [],
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
        },
        agent: {
          defaultPermissionMode: "default",
        },
      } as never)
      const harness = createHarness({})

      await expect(
        harness.invoke("synapse:app:agent:operation:send", {
          projectId: "missing-project",
          sessionKey: "local:renderer",
          conversationId: "conv-missing",
          content: "hi",
        }),
      ).rejects.toThrow("找不到当前项目")

      const phases = harness.eventBusEmits
        .filter((e) => e.type === "phase.update")
        .map((e) => {
          const payload = e.payload as { phase: string; status: string; conversationId?: string; errorMessage?: string }
          return {
            phase: payload.phase,
            status: payload.status,
            conversationId: payload.conversationId,
            errorMessage: payload.errorMessage,
          }
        })

      expect(phases).toEqual([{
        phase: "failed",
        status: "failed",
        conversationId: "conv-missing",
        errorMessage: "发送失败",
      }])
      expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
        "Agent send IPC failed.",
        expect.objectContaining({
          projectId: "missing-project",
          sessionKey: "local:renderer",
          conversationId: "conv-missing",
          boundary: "agent.send.ipc",
        }),
      )
    })
  })
})

function createHarness(overrides: {
  readonly agent?: Record<string, unknown>
  readonly providerService?: Record<string, unknown>
  readonly dataRepository?: Record<string, unknown>
  readonly storageMigration?: { isActive: ReturnType<typeof vi.fn> }
}) {
  const agent = {
    getStatus: () => ({
      projectId: "project-1",
      agentType: "claude-code",
      liveSessions: 0,
      busySessions: 0,
      queuedTurns: 0,
      pendingPermissions: 0,
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    send: vi.fn(),
    sendToConversation: vi.fn(),
    stageAttachmentPaths: vi.fn(async ({ paths }: { readonly paths: readonly string[] }) => Promise.all(paths.map(async (sourcePath) => {
      const stat = await fs.lstat(sourcePath)
      if (stat.isSymbolicLink()) throw new Error("symbolic link")
      if (path.extname(sourcePath).toLowerCase() === ".png" && stat.size === 0) throw new Error("empty image")
      return { ref: testAttachmentRefForPath(sourcePath, stat.isDirectory(), stat.size) }
    }))),
    stageAttachmentBytes: vi.fn(),
    releaseAttachments: vi.fn().mockResolvedValue(undefined),
    resolveStagedAttachments: vi.fn(async (attachmentIds: readonly string[]) => ({
      draftScopeId: "draft-1",
      refs: attachmentIds.map((attachmentId) => testImageRef(attachmentId)),
    })),
    listPendingPermissions: vi.fn().mockReturnValue([]),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    ...overrides.agent,
  }
  const providerService = {
    listProviders: vi.fn().mockResolvedValue([]),
    getActiveProvider: vi.fn().mockResolvedValue(null),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    archiveProvider: vi.fn(),
    setActiveProvider: vi.fn(),
    ...overrides.providerService,
  }
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T>(id: string): T => {
      if (id === AGENT_RUNTIME_SERVICE_ID) return agent as T
      if (id === PROVIDER_SERVICE_ID) return providerService as T
      throw new Error(`Unknown service: ${id}`)
    },
    inspect: () => [],
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
    open: vi.fn().mockResolvedValue(container),
  }
  const dataRepository = overrides.dataRepository ?? {
    namespace: vi.fn(() => ({
      name: "test",
      schemaVersion: 1,
      backend: "sqlite",
      getSingleton: vi.fn().mockResolvedValue(null),
      setSingleton: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      onChange: vi.fn(() => () => {}),
    })),
  }
  const permissionGuard = {
    check: vi.fn().mockResolvedValue({ allowed: true }),
  }
  const auditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const harness = createInMemoryHarness()
  const eventBusEmits: Array<{ domain: string; type: string; payload: unknown; timestamp?: string }> = []
  const eventBus = {
    emit: (event: { domain: string; type: string; payload: unknown; timestamp?: string }) => {
      eventBusEmits.push(event)
    },
    emitInternal: () => {},
    on: () => () => {},
    onType: () => () => {},
  }
  const conversationWindowService = {
    openConversationWindow: vi.fn(async () => ({ opened: true })),
    focusConversationWindow: vi.fn(() => ({ focused: true })),
    listDetachedConversations: vi.fn(() => []),
    closeConversationWindow: vi.fn(() => ({ closed: true })),
  }
  const storageMigration = overrides.storageMigration ?? { isActive: vi.fn(() => false) }
  const resolve: IpcHandlerContext["resolve"] = <T>(serviceId: string): T => {
    if (serviceId === "core.project-containers") return projectContainers as T
    if (serviceId === "core.event-bus") return eventBus as T
    if (serviceId === "core.data-repository") return dataRepository as T
    if (serviceId === "core.permission-guard") return permissionGuard as T
    if (serviceId === "core.audit-sink") return auditSink as T
    if (serviceId === PROVIDER_SERVICE_ID) return providerService as T
    if (serviceId === AGENT_CONVERSATION_WINDOW_SERVICE_ID) return conversationWindowService as T
    if (serviceId === "knowledge-base.storage-migration-service") return storageMigration as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(agentIpcModule, {
    moduleId: "agent",
    resolve,
  })
  return Object.assign(harness, {
    projectContainers,
    eventBusEmits,
    dataRepository,
    permissionGuard,
    auditSink,
    conversationWindowService,
  })
}

function testAttachmentRefForPath(sourcePath: string, isDirectory = false, byteSize = 7) {
  const attachmentId = `attachment-${path.basename(sourcePath)}`
  const name = path.basename(sourcePath)
  if (path.extname(sourcePath).toLowerCase() === ".png") return testImageRef(attachmentId, name)
  if (isDirectory) {
    return { version: 2 as const, attachmentId, kind: "directory" as const, name, byteSize: 0, path: sourcePath }
  }
  return { version: 2 as const, attachmentId, kind: "file" as const, name, byteSize, sha256: "1".repeat(64) }
}

function testImageRef(attachmentId: string, name = "screen.png") {
  return {
    version: 2 as const,
    attachmentId,
    kind: "image" as const,
    name,
    byteSize: 3,
    mimeType: "image/png" as const,
    previewUrl: `synapse-agent-artifact://local/${attachmentId}/preview.png`,
    thumbnailUrl: `synapse-agent-artifact://local/${attachmentId}/thumbnail.png`,
    sha256: "1".repeat(64),
  }
}
