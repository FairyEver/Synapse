import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  uploadService: {
    uploadSkillDraftToContentStore: vi.fn(),
  },
}))

vi.mock("../../../services/content-store-upload-service", () => ({
  contentStoreUploadService: mocks.uploadService,
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanAll: vi.fn(),
  readItemContent: vi.fn(),
  listSkillFiles: vi.fn(),
  prepareQuickPublishDraft: vi.fn(),
  trashScanItem: vi.fn(),
}))

import { editorScanIpcModule } from "../ipc"

describe("editorScanIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadService.uploadSkillDraftToContentStore.mockResolvedValue({
      draftId: "draft-1",
      itemId: "item-1",
      revision: 1,
      dashboardEditUrl: "https://synapse.example.test/dashboard/my-content/item-1/edit",
    })
  })

  it("uploads Skill drafts through the content store upload service", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project",
    })).resolves.toEqual({
      draftId: "draft-1",
      itemId: "item-1",
      revision: 1,
      dashboardEditUrl: "https://synapse.example.test/dashboard/my-content/item-1/edit",
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
  })

  it("rejects Rule and Prompt uploads before calling the service", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "rule",
      itemPath: "/tmp/rules/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以发布到商店。")
    await expect(harness.invoke("synapse:editor-scan:upload-skill-draft-to-content-store", {
      itemType: "prompt",
      itemPath: "/tmp/prompts/review.md",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("只有 Skill 可以发布到商店。")

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
