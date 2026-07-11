import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
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
  chmod: vi.fn(),
  getSkillDetail: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  prepareSkillDirectory: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  resolveTarget: vi.fn(),
  configStore: {
    load: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
}))

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")

  return {
    ...actual,
    chmod: mocks.chmod,
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

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getSkillDetail: mocks.getSkillDetail,
  },
}))

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../definitions/generated/main-registry", () => ({
  editorInstallStrategyById: new Map([
    ["test-editor", { prepareSkillDirectory: mocks.prepareSkillDirectory }],
  ]),
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
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
    source: "repository",
    title: "Test Skill",
    type: "skill",
  }
}

describe("EditorInstallService security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configStore.load.mockResolvedValue({
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        localPath: "/repo",
        contentDirs: {},
      }],
    })
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: true,
      gitRootPath: "/repo",
    })
    mocks.chmod.mockImplementation(async (...args: Parameters<typeof import("node:fs/promises")["chmod"]>) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.chmod(...args)
    })
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
    await writeFile(path.join(targetPath, ".env"), "TOKEN=existing\nCUSTOM=user-only\n", "utf8")

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
      await writeFile(
        path.join(stagingDirectoryPath, ".env.example"),
        "TOKEN=default\nNEW_KEY=default\n",
        "utf8",
      )
    })

    const auditSink = new InMemoryAuditSink()
    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      replaceConfirmed: true,
      skillEnvValues: { TOKEN: "submitted", NEW_KEY: "confirmed" },
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
    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe('TOKEN=existing\nCUSTOM=user-only\nNEW_KEY="confirmed"\n')
    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8")).resolves.toBe("# Existing Skill\n")
    await expect(readFile(path.join(backupPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=existing\nCUSTOM=user-only\n")
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

  it("restores a conflict replacement when the backed-up .env changes after materialization", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
    await writeFile(path.join(targetPath, ".env"), "TOKEN=existing\n", "utf8")
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
      await writeFile(path.join(stagingDirectoryPath, ".env.example"), "TOKEN=\n", "utf8")
    })
    mocks.chmod.mockImplementationOnce(async (...args: Parameters<typeof import("node:fs/promises")["chmod"]>) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      await actual.chmod(...args)
      await writeFile(path.join(backupPath, ".env"), "TOKEN=changed-after-materialize\n", "utf8")
    })

    await expect(editorInstallService.installToEditor({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      replaceConfirmed: true,
      scope: "global",
    }, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("Skill .env 在读取期间发生变化。")

    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8"))
      .resolves.toBe("# Existing Skill\n")
    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=changed-after-materialize\n")
    await expect(lstat(backupPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each(["env", "directory"] as const)(
    "keeps a changed internal backup after successful install and returns a warning (%s)",
    async (mutation) => {
      const root = await createTempRoot()
      const targetPath = path.join(root, "skills", "test-skill")
      let internalBackupPath = ""
      let displacedOriginalPath = ""
      let renameCall = 0
      await mkdir(targetPath, { recursive: true })
      await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
      await writeFile(path.join(targetPath, ".env"), "TOKEN=original\n", "utf8")

      mocks.rename.mockImplementation(async (sourcePath, destinationPath) => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
        renameCall += 1
        await actual.rename(sourcePath, destinationPath)
        if (renameCall === 1) {
          internalBackupPath = String(destinationPath)
          return
        }
        if (renameCall !== 2) return
        if (mutation === "env") {
          await writeFile(path.join(internalBackupPath, ".env"), "TOKEN=changed-after-install\n", "utf8")
          return
        }
        displacedOriginalPath = `${internalBackupPath}-displaced`
        await actual.rename(internalBackupPath, displacedOriginalPath)
        await mkdir(internalBackupPath)
        await writeFile(path.join(internalBackupPath, "concurrent-marker.txt"), "concurrent", "utf8")
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
      mocks.prepareSkillDirectory.mockImplementation(async (
        { stagingDirectoryPath }: { stagingDirectoryPath: string },
      ) => {
        await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# New Skill\n", "utf8")
      })

      const result = await editorInstallService.installToEditor({
        contentId: "skill-1",
        contentType: "skill",
        editorId: "test-editor",
        overwriteConfirmed: true,
        scope: "global",
      }, {
        actor: { kind: "user" },
        auditSink: new InMemoryAuditSink(),
        permissionGuard: createPermissionGuard(),
      })

      expect(result.warning).toBe("旧 Skill 备份发生变化，已保留，请手动检查。")
      await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8"))
        .resolves.toBe("# New Skill\n")
      await expect(readFile(path.join(targetPath, ".env"), "utf8"))
        .resolves.toBe("TOKEN=original\n")
      if (mutation === "env") {
        await expect(readFile(path.join(internalBackupPath, ".env"), "utf8"))
          .resolves.toBe("TOKEN=changed-after-install\n")
      } else {
        await expect(readFile(path.join(internalBackupPath, "concurrent-marker.txt"), "utf8"))
          .resolves.toBe("concurrent")
        await expect(readFile(path.join(displacedOriginalPath, ".env"), "utf8"))
          .resolves.toBe("TOKEN=original\n")
      }
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "Retained changed atomic swap backup",
        expect.objectContaining({ targetName: "test-skill", errorName: "Error" }),
      )
    },
  )

  it("deletes an unchanged internal backup after successful install", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    let internalBackupPath = ""
    let renameCall = 0
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
    await writeFile(path.join(targetPath, ".env"), "TOKEN=original\n", "utf8")
    mocks.rename.mockImplementation(async (sourcePath, destinationPath) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      renameCall += 1
      await actual.rename(sourcePath, destinationPath)
      if (renameCall === 1) internalBackupPath = String(destinationPath)
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
    mocks.prepareSkillDirectory.mockImplementation(async (
      { stagingDirectoryPath }: { stagingDirectoryPath: string },
    ) => {
      await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# New Skill\n", "utf8")
    })

    const result = await editorInstallService.installToEditor({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      scope: "global",
    }, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })

    expect(result.warning).toBeUndefined()
    await expect(lstat(internalBackupPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps a warning when deleting a validated internal backup fails", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    let internalBackupPath = ""
    let renameCall = 0
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing Skill\n", "utf8")
    await writeFile(path.join(targetPath, ".env"), "TOKEN=original\n", "utf8")
    mocks.rename.mockImplementation(async (sourcePath, destinationPath) => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      renameCall += 1
      await actual.rename(sourcePath, destinationPath)
      if (renameCall === 1) internalBackupPath = String(destinationPath)
    })
    mocks.rm.mockImplementation(async (target, options) => {
      if (String(target) === internalBackupPath) {
        throw Object.assign(new Error("simulated backup cleanup failure"), { code: "EACCES" })
      }
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      return actual.rm(target, options)
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
    mocks.prepareSkillDirectory.mockImplementation(async (
      { stagingDirectoryPath }: { stagingDirectoryPath: string },
    ) => {
      await writeFile(path.join(stagingDirectoryPath, "SKILL.md"), "# New Skill\n", "utf8")
    })

    const result = await editorInstallService.installToEditor({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      overwriteConfirmed: true,
      scope: "global",
    }, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })

    expect(result.warning).toBe("旧 Skill 备份发生变化，已保留，请手动检查。")
    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8"))
      .resolves.toBe("# New Skill\n")
    await expect(readFile(path.join(internalBackupPath, "SKILL.md"), "utf8"))
      .resolves.toBe("# Existing Skill\n")
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

  it("preserves a concurrent target and desktop backup when replacement fails after backup", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "test-skill")
    const backupPath = path.join(testDesktopPath, "test-skill-synapse备份")
    const markerPath = path.join(targetPath, "concurrent-marker.txt")
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
    mocks.prepareSkillDirectory.mockImplementation(async () => {
      await mkdir(targetPath, { recursive: true })
      await writeFile(markerPath, "concurrent", "utf8")
      throw new Error("prepare failed")
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
    })).rejects.toThrow("旧 Skill 备份恢复失败")

    await expect(readFile(markerPath, "utf8")).resolves.toBe("concurrent")
    await expect(readFile(path.join(backupPath, "SKILL.md"), "utf8"))
      .resolves.toBe("# Existing Skill\n")
    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.write",
        outcome: "failed",
        resource: backupPath,
        metadata: expect.objectContaining({ operation: "install-backup-restore" }),
      }),
      expect.objectContaining({
        action: "fs.write",
        outcome: "failed",
        resource: targetPath,
      }),
    ]))
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to restore backed up skill directory",
      expect.objectContaining({
        backupPath: path.basename(backupPath),
        targetPath: path.basename(targetPath),
        errorName: "Error",
      }),
    )
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
