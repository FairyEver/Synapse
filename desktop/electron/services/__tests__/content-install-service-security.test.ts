import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseInstallToEditorPayload } from "../../../src/types/editor"
import type { SynapseSkillDetail } from "../../../src/types/content"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../runtime/security"

const mocks = vi.hoisted(() => ({
  getSkillDetail: vi.fn(),
  prepareSkillDirectory: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-content-install-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("../editor-adapter-service", () => ({
  editorAdapterService: {
    resolveTarget: mocks.resolveTarget,
  },
}))

vi.mock("../content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getSkillDetail: mocks.getSkillDetail,
  },
}))

vi.mock("../definitions/generated/main-registry", () => ({
  editorInstallStrategyById: new Map([
    ["test-editor", { prepareSkillDirectory: mocks.prepareSkillDirectory }],
  ]),
}))

import { contentInstallService } from "../content-install-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-install-"))
  tempRoots.push(root)
  return root
}

function createSkillDetail(contentId: string): SynapseSkillDetail {
  return {
    attachmentCount: 0,
    attachments: [],
    category: "test",
    content: "# Test Skill\n",
    createdAt: "2026-04-28T00:00:00.000Z",
    createdBy: "user",
    createdByDisplayName: "User",
    deleted: false,
    description: "",
    icon: "",
    iconBg: "",
    id: contentId,
    latestHistoryDirname: "current",
    modifiedAt: "2026-04-28T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    name: "test-skill",
    source: "builtin",
    title: "Test Skill",
    type: "skill",
  }
}

describe("ContentInstallService security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("rejects Skill replacement when backing up the existing target fails and records a failed audit", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const conflictingBackupPath = `${targetPath}-backup`
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
    await mkdir(conflictingBackupPath, { recursive: true })
    await writeFile(path.join(conflictingBackupPath, "locked.txt"), "backup exists", "utf8")

    mocks.resolveTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "test-editor",
      label: "Test Editor",
      message: null,
      scope: "global",
      status: "ready",
      targetExists: true,
      targetKind: "directory",
      targetPath,
    })
    mocks.getSkillDetail.mockResolvedValue(createSkillDetail("skill-1"))
    mocks.prepareSkillDirectory.mockImplementation(async (
      { stagingDirectoryPath }: { stagingDirectoryPath: string },
    ) => {
      await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# New Skill\n", "utf8")
    })

    const auditSink = new InMemoryAuditSink()
    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(contentInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("备份旧 Skill 失败，未替换目标。")

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "failed",
        resource: targetPath,
      }),
    ])
  })
})
