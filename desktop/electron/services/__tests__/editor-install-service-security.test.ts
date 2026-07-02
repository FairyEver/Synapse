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
  rm: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")

  return {
    ...actual,
    rename: mocks.rename,
    rm: mocks.rm,
  }
})

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-install-test-${which}`,
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

import { editorInstallService } from "../editor-install-service"

const tempRoots: string[] = []
const testDesktopPath = "/tmp/synapse-editor-install-test-desktop"

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-install-"))
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

describe("EditorInstallService security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rename.mockImplementation(async (
      oldPath: Parameters<typeof import("node:fs/promises")["rename"]>[0],
      newPath: Parameters<typeof import("node:fs/promises")["rename"]>[1],
    ) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.rename(oldPath, newPath)
    })
    mocks.rm.mockImplementation(async (
      targetPath: Parameters<typeof import("node:fs/promises")["rm"]>[0],
      options?: Parameters<typeof import("node:fs/promises")["rm"]>[1],
    ) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.rm(targetPath, options)
    })
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    await rm(testDesktopPath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("rejects overwriting an existing Skill directory without confirmation", async () => {
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

    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("覆盖目标目录前需要用户确认。")

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(mocks.prepareSkillDirectory).not.toHaveBeenCalled()
  })

  it("allows reinstalling the same Skill directory without overwrite confirmation", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, ".synapse.json"), JSON.stringify({ id: "skill-1" }), "utf8")
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
      await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# Updated Skill\n", "utf8")
    })

    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# Updated Skill\n")
  })

  it("does not clean up a Windows case-equivalent previous Skill directory after install", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const root = await createTempRoot()
    const previousSkillDirectoryPath = path.join(root, "skills", "ReviewHelper")
    const targetPath = path.join(root, "skills", "reviewhelper")
    await mkdir(previousSkillDirectoryPath, { recursive: true })
    await writeFile(path.join(previousSkillDirectoryPath, ".synapse.json"), JSON.stringify({ id: "skill-1" }), "utf8")
    await writeFile(path.join(previousSkillDirectoryPath, "SKILL.md"), "# Existing Skill\n", "utf8")

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
      await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# Updated Skill\n", "utf8")
    })

    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    expect(mocks.rm).not.toHaveBeenCalledWith(
      previousSkillDirectoryPath,
      expect.objectContaining({ recursive: true, force: true }),
    )
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
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
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
    expect(auditSink.list()).toContainEqual(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      outcome: "allowed",
      resource: backupPath,
      metadata: expect.objectContaining({ operation: "install-backup" }),
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
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
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

  it("uses a unique Skill backup path when a stale desktop backup symlink already exists", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    const uniqueBackupPath = `${backupPath}-2`
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
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })).resolves.toMatchObject({
      contentId: "skill-1",
      targetPath,
    })

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# New Skill\n")
    await expect(readFile(path.join(uniqueBackupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toContainEqual(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      outcome: "allowed",
      resource: uniqueBackupPath,
      metadata: expect.objectContaining({ operation: "install-backup" }),
    }))
  })

  it("requires write permission for the desktop Skill backup path before replacing", async () => {
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
    const auditSink = new InMemoryAuditSink()
    const permissionGuard = createPermissionGuard()
    permissionGuard.registerPolicy({
      id: "deny-backup",
      decide: (request) => request.resource === backupPath ? "deny" : "defer-to-next",
    })
    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard,
    })).rejects.toThrow("没有写入该位置的权限。")

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toContainEqual(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      outcome: "denied",
      resource: backupPath,
      metadata: expect.objectContaining({ operation: "install-backup" }),
    }))
    expect(auditSink.list()).not.toContainEqual(expect.objectContaining({
      outcome: "allowed",
      resource: targetPath,
    }))
  })

  it("restores the old Skill directory when replacement fails after backup", async () => {
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
    mocks.prepareSkillDirectory.mockRejectedValue(new Error("prepare failed"))

    const auditSink = new InMemoryAuditSink()
    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("prepare failed")

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "allowed",
        resource: backupPath,
        metadata: expect.objectContaining({ operation: "install-backup" }),
      }),
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "allowed",
        resource: backupPath,
        metadata: expect.objectContaining({ operation: "install-backup-restore" }),
      }),
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "failed",
        resource: targetPath,
      }),
    ]))
  })

  it("reports restore failure when replacement fails after backup", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")

    mocks.rename.mockImplementation(async (
      oldPath: Parameters<typeof import("node:fs/promises")["rename"]>[0],
      newPath: Parameters<typeof import("node:fs/promises")["rename"]>[1],
    ) => {
      if (String(oldPath) === backupPath && String(newPath) === targetPath) {
        throw new Error("restore failed")
      }

      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.rename(oldPath, newPath)
    })
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
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("旧 Skill 备份恢复失败")

    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "allowed",
        resource: backupPath,
        metadata: expect.objectContaining({ operation: "install-backup" }),
      }),
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "failed",
        resource: backupPath,
        metadata: expect.objectContaining({ operation: "install-backup-restore" }),
      }),
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "failed",
        resource: targetPath,
      }),
    ]))
  })
})
