import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
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
  rename: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")

  return {
    ...actual,
    rename: mocks.rename,
  }
})

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
const testDesktopPath = "/tmp/synapse-content-install-test-desktop"

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
    mocks.rename.mockImplementation(async (
      oldPath: Parameters<typeof import("node:fs/promises")["rename"]>[0],
      newPath: Parameters<typeof import("node:fs/promises")["rename"]>[1],
    ) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.rename(oldPath, newPath)
    })
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    await rm(testDesktopPath, { recursive: true, force: true })
  })

  it("moves the old Skill to the desktop when replacing it", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")

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
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# New Skill\n")
    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toContainEqual(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      outcome: "allowed",
      resource: targetPath,
    }))
  })

  it("copies the old Skill to desktop backup when rename crosses devices", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")

    mocks.rename.mockRejectedValueOnce(Object.assign(new Error("cross-device link not permitted"), {
      code: "EXDEV",
    }))
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

    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(contentInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# New Skill\n")
    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
  })

  it("replaces Skill when a stale desktop backup symlink already exists", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
    await rm(backupPath, { recursive: true, force: true })
    await mkdir(path.dirname(backupPath), { recursive: true })
    await symlink(path.join(root, "missing-backup-target"), backupPath)

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
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# New Skill\n")
    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
  })

  it("restores the old Skill directory when replacement fails after backup", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")

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
    mocks.prepareSkillDirectory.mockRejectedValue(new Error("prepare failed"))

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
    })).rejects.toThrow("prepare failed")

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
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
