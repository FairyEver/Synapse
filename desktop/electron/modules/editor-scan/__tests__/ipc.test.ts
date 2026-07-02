import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  uploadService: {
    uploadSkillDraftToContentStore: vi.fn(),
  },
  editorScanService: {
    assertTrustedEditorReadTarget: vi.fn(),
  },
}))

vi.mock("../../../services/content-store-upload-service", () => ({
  contentStoreUploadService: mocks.uploadService,
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanAll: vi.fn(),
  readItemContent: vi.fn(),
  listSkillFiles: vi.fn(),
  assertTrustedEditorReadTarget: mocks.editorScanService.assertTrustedEditorReadTarget,
  prepareQuickPublishDraft: vi.fn(),
  trashScanItem: vi.fn(),
}))

import { editorScanIpcModule } from "../ipc"

describe("editorScanIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadService.uploadSkillDraftToContentStore.mockResolvedValue({
      draftId: "repo-1",
      itemId: "repo-1",
      revision: 1,
      consoleEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      dashboardEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
    })
    mocks.editorScanService.assertTrustedEditorReadTarget.mockResolvedValue(undefined)
  })

  it("uploads scanned Skills through the compatibility channel", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })).resolves.toEqual({
      draftId: "repo-1",
      itemId: "repo-1",
      revision: 1,
      consoleEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      dashboardEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
    })

    expect(mocks.uploadService.uploadSkillDraftToContentStore).toHaveBeenCalledWith(
      {
        itemType: "skill",
        itemPath: "/tmp/skills/review",
        itemName: "review",
        editorId: "claude-code",
        scope: "project",
        projectPath: "/tmp/project",
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
        operation: "upload-skill-draft-to-content-store",
      },
      "skill",
    )
  })

  it("rejects Skill uploads outside trusted editor roots", async () => {
    const harness = createHarness()
    mocks.editorScanService.assertTrustedEditorReadTarget.mockRejectedValueOnce(
      new Error("扫描项不在当前编辑器扫描范围内。"),
    )

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "skill",
      itemPath: "/tmp/outside/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })).rejects.toThrow("扫描项不在当前编辑器扫描范围内。")

    expect(mocks.uploadService.uploadSkillDraftToContentStore).not.toHaveBeenCalled()
  })

  it("rejects Rule and Prompt uploads before calling the service", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "rule",
      itemPath: "/tmp/rules/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以上传到 Skill Repository。")
    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "prompt",
      itemPath: "/tmp/prompts/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以上传到 Skill Repository。")

    expect(mocks.uploadService.uploadSkillDraftToContentStore).not.toHaveBeenCalled()
  })

  it("rejects invalid upload payloads", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "skill",
      itemPath: "",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow()

    expect(mocks.uploadService.uploadSkillDraftToContentStore).not.toHaveBeenCalled()
  })

  it("propagates unauthenticated upload failures", async () => {
    const harness = createHarness()
    mocks.uploadService.uploadSkillDraftToContentStore.mockRejectedValueOnce(new Error("账号未登录。"))

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
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
