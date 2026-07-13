import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  uploadService: {
    importLocal: vi.fn(),
  },
  contentSkillSourceService: {
    resolveSkillMainFile: vi.fn(),
  },
  editorScanService: {
    assertTrustedEditorReadTarget: vi.fn(),
    finalizeQuickPublish: vi.fn(),
    trashScanItem: vi.fn(),
  },
}))

vi.mock("../../../services/skill-repository-upload-service", () => ({
  skillRepositoryUploadService: mocks.uploadService,
}))

vi.mock("../../../services/content-skill-source-service", () => ({
  resolveSkillMainFile: mocks.contentSkillSourceService.resolveSkillMainFile,
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanAll: vi.fn(),
  readItemContent: vi.fn(),
  listSkillFiles: vi.fn(),
  assertTrustedEditorReadTarget: mocks.editorScanService.assertTrustedEditorReadTarget,
  finalizeQuickPublish: mocks.editorScanService.finalizeQuickPublish,
  prepareQuickPublishDraft: vi.fn(),
  trashScanItem: mocks.editorScanService.trashScanItem,
}))

import { editorScanIpcModule } from "../ipc"

describe("editorScanIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadService.importLocal.mockResolvedValue({
      repositoryId: "repo-1",
      name: "review",
      owner: "alice",
      managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      identityWritten: true,
      identityMigrated: false,
      sourceImportSummary: {
        controlFilesExcluded: [],
        fileCount: 1,
        hiddenEntryCount: 0,
        runtimeEnvExcluded: false,
        symlinkCount: 0,
        totalBytes: 10,
      },
    })
    mocks.contentSkillSourceService.resolveSkillMainFile.mockResolvedValue("/tmp/skills/review/SKILL.md")
    mocks.editorScanService.assertTrustedEditorReadTarget.mockResolvedValue(undefined)
    mocks.editorScanService.finalizeQuickPublish.mockResolvedValue({
      status: "identity-written",
      message: "本地 Skill 已关联到已保存内容。",
    })
    mocks.editorScanService.trashScanItem.mockResolvedValue({
      trashed: true,
      mode: "path",
      path: "/tmp/skills/review",
    })
  })

  it("rejects Skill removal through the legacy editor scan trash channel", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:trash-item", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    })).rejects.toThrow()

    expect(mocks.editorScanService.trashScanItem).not.toHaveBeenCalled()
  })

  it("finalizes a checked Skill publish through the main process", async () => {
    const harness = createHarness()
    const request = {
      contentId: "skill-1",
      mode: "new" as const,
      repositoryVersion: "20260713010101",
      sessionId: "c5e23732-3f58-40c2-9d71-7ce5d0df07be",
    }

    await expect(harness.invoke("synapse:editor-scan:finalize-quick-publish", request)).resolves.toEqual({
      status: "identity-written",
      message: "本地 Skill 已关联到已保存内容。",
    })
    expect(mocks.editorScanService.finalizeQuickPublish).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ actor: { kind: "user" } }),
    )
  })

  it("uploads scanned Skills through the Skill Repository channel", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })).resolves.toEqual({
      repositoryId: "repo-1",
      name: "review",
      owner: "alice",
      managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      identityWritten: true,
      identityMigrated: false,
      sourceImportSummary: {
        controlFilesExcluded: [],
        fileCount: 1,
        hiddenEntryCount: 0,
        runtimeEnvExcluded: false,
        symlinkCount: 0,
        totalBytes: 10,
      },
    })

    expect(mocks.uploadService.importLocal).toHaveBeenCalledWith(
      {
        sourceDirectoryPath: "/tmp/skills/review",
        name: "review",
        openInBrowser: false,
      },
      {
        actor: { kind: "user" },
        auditSink: expect.objectContaining({ record: expect.any(Function) }),
        permissionGuard: expect.objectContaining({ check: expect.any(Function) }),
      },
    )
    expect(mocks.editorScanService.assertTrustedEditorReadTarget).toHaveBeenCalledWith(
      {
        actor: { kind: "user" },
        auditSink: expect.objectContaining({ record: expect.any(Function) }),
        permissionGuard: expect.objectContaining({ check: expect.any(Function) }),
      },
      "/tmp/skills/review",
      {
        contentType: "skill",
        itemName: "review",
        operation: "upload-skill-to-skill-repository",
      },
      "skill",
    )
  })

  it("rejects fallback Skill main files before importing to Skill Repository", async () => {
    const harness = createHarness()
    mocks.contentSkillSourceService.resolveSkillMainFile.mockResolvedValueOnce("/tmp/skills/review/README.md")

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
      mainFileName: "README.md",
    })).rejects.toThrow("上传到 Skill Repository 需要根目录 SKILL.md。")

    expect(mocks.uploadService.importLocal).not.toHaveBeenCalled()
  })

  it("rejects Skill uploads outside trusted editor roots", async () => {
    const harness = createHarness()
    mocks.editorScanService.assertTrustedEditorReadTarget.mockRejectedValueOnce(
      new Error("扫描项不在当前编辑器扫描范围内。"),
    )

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "skill",
      itemPath: "/tmp/outside/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })).rejects.toThrow("扫描项不在当前编辑器扫描范围内。")

    expect(mocks.uploadService.importLocal).not.toHaveBeenCalled()
  })

  it("rejects Rule and Prompt uploads before calling the service", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "rule",
      itemPath: "/tmp/rules/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以上传到 Skill Repository。")
    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "prompt",
      itemPath: "/tmp/prompts/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以上传到 Skill Repository。")

    expect(mocks.uploadService.importLocal).not.toHaveBeenCalled()
  })

  it("rejects invalid upload payloads", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "skill",
      itemPath: "",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow()

    expect(mocks.uploadService.importLocal).not.toHaveBeenCalled()
  })

  it("propagates unauthenticated upload failures", async () => {
    const harness = createHarness()
    mocks.uploadService.importLocal.mockRejectedValueOnce(new Error("账号未登录。"))

    await expect(harness.invoke("synapse:editor-scan:upload-skill-to-skill-repository", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("账号未登录。")
  })
})

function createHarness() {
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn() }
  const harness = createInMemoryHarness()
  harness.registry.register(editorScanIpcModule, {
    moduleId: "editor-scan",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.audit-sink") return auditSink as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      throw new Error(`unexpected service ${serviceId}`)
    },
  })
  return harness
}
