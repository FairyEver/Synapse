import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getContent: vi.fn(),
  getGlobalRulesPath: vi.fn(),
  prepareSkillDirectory: vi.fn(),
  prepareRuleFileContent: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-installer-source-${name}`),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../content-service", () => ({
  contentService: {
    getContent: mocks.getContent,
    getSkillDetail: vi.fn(),
  },
}))

vi.mock("../editor-adapter-service", () => ({
  editorAdapterService: {
    resolveTarget: mocks.resolveTarget,
  },
}))

vi.mock("../editor-adapters", () => ({
  editorAdapterById: new Map([
    ["test-editor", {
      getScanPathConfig: () => ({
        detectionDir: os.tmpdir(),
        globalRulesPath: mocks.getGlobalRulesPath(),
        globalSkillsPath: null,
        projectPaths: (projectPath: string) => ({
          rulesPath: path.join(projectPath, "rules"),
          skillsPath: path.join(projectPath, "skills"),
        }),
        rulesSupported: true,
      }),
    }],
  ]),
}))

vi.mock("../definitions/generated/main-registry", () => ({
  editorInstallStrategyById: new Map([
    ["test-editor", {
      prepareRuleFileContent: mocks.prepareRuleFileContent,
      prepareSkillDirectory: mocks.prepareSkillDirectory,
    }],
  ]),
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({
      activeRepoUuid: null,
      repositories: [],
      global: { projects: [] },
    })),
  },
}))

import { EditorInstallService } from "../editor-install-service"
import { configStore } from "../config-store"
import type { SynapseContentDetail } from "../../../src/types/content"
import type { ContentSkillSourceSecurityDeps } from "../content-skill-source-service"
import { installerSourceService } from "../installer-source-service"

const tempRoots: string[] = []
const allowSkillSourceRead = {
  actor: { kind: "user" },
  auditSink: {
    clearForTests() {},
    list: () => [],
    record() {},
  },
  permissionGuard: {
    check: async () => ({ allowed: true }),
    registerPolicy: () => () => {},
  },
} satisfies ContentSkillSourceSecurityDeps

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-installer-source-"))
  tempRoots.push(root)
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getGlobalRulesPath.mockReturnValue(null)
  mocks.prepareSkillDirectory.mockImplementation(async ({
    copyAttachment,
    detail,
    stagingDirectoryPath,
    writeTextFile,
  }) => {
    await writeTextFile(path.join(stagingDirectoryPath, "SKILL.md"), detail.content)
    for (const attachment of detail.attachments) {
      await copyAttachment(attachment, path.join(stagingDirectoryPath, attachment.originalName))
    }
  })
})

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("EditorInstallCore installer source", () => {
  it("installs an inline Rule through the existing editor strategy", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "rules", "team.rule.md")
    mocks.getGlobalRulesPath.mockReturnValue(path.join(root, "rules"))
    mocks.resolveTarget.mockResolvedValue({
      editorId: "test-editor",
      label: "Test Editor",
      scope: "global",
      contentType: "rule",
      message: null,
      status: "ready",
      targetKind: "file",
      targetPath,
      targetExists: false,
    })
    mocks.prepareRuleFileContent.mockResolvedValue("# Team Rule\n")
    const source = await installerSourceService.prepareInlineRuleSource({
      name: "team.rule",
      body: "# Team Rule",
    })
    const service = new EditorInstallService()

    await service.installSourceToEditor({
      editorId: "test-editor" as never,
      scope: "global",
      source,
    })

    expect(mocks.getContent).not.toHaveBeenCalled()
    expect(mocks.prepareRuleFileContent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        contentId: source.sourceIdentity,
        contentType: "rule",
        ruleName: "team.rule",
      }),
      ruleBody: "# Team Rule",
    }))
    await expect(readFile(targetPath, "utf8")).resolves.toBe("# Team Rule\n")
  })

  it("materializes Skill env values without substituting SKILL.md", async () => {
    const root = await createTempRoot()
    const sourcePath = path.join(root, "source")
    const targetPath = path.join(root, "skills", "env-skill")
    await mkdir(sourcePath, { recursive: true })
    await writeFile(
      path.join(sourcePath, "SKILL.md"),
      "---\nname: env-skill\ndescription: Env Skill\n---\nUse ${{ TOKEN }} at runtime.\n",
      "utf8",
    )
    await writeFile(path.join(sourcePath, ".env.example"), "TOKEN=\nREGION=cn\n", "utf8")
    mocks.resolveTarget.mockResolvedValue({
      editorId: "test-editor",
      label: "Test Editor",
      scope: "global",
      contentType: "skill",
      message: null,
      status: "ready",
      targetKind: "directory",
      targetPath,
      targetExists: false,
    })
    const source = await installerSourceService.prepareLocalSkillSource({
      sourceDirectoryPath: sourcePath,
    }, allowSkillSourceRead)
    const service = new EditorInstallService()

    await service.installSourceToEditor({
      editorId: "test-editor" as never,
      scope: "global",
      skillEnvValues: { TOKEN: "saved-token" },
      source,
    })

    await expect(readFile(path.join(targetPath, ".env.example"), "utf8"))
      .resolves.toBe("TOKEN=\nREGION=cn\n")
    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=\"saved-token\"\nREGION=cn\n")
    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8"))
      .resolves.toContain("Use ${{ TOKEN }} at runtime.")
  })
})

describe("Hub package installation", () => {
  const id = `skill-hub:${"a".repeat(64)}:skill_a`
  const source = { kind: "skill", origin: "skill-hub", name: "new-name", title: "商店名称", description: "Package description",
    sourceIdentity: id, preparedSourceId: "skill-hub-install:fixture", repositoryVersion: "ver_2", hubVersionNumber: 2 } as const
  const raw = "---\nname: new-name\ndescription: Package description\n---\nFull package."
  async function fixture() {
    const root = await createTempRoot()
    const oldPath = path.join(root, "old-name")
    const targetPath = path.join(root, "new-name")
    await mkdir(oldPath)
    await writeFile(path.join(oldPath, "SKILL.md"), "original")
    await writeFile(path.join(oldPath, ".synapse.json"), JSON.stringify({ kind: "skill-hub", id }))
    const anotherPath = path.join(root, "another-editor", "old-name")
    await mkdir(anotherPath, { recursive: true })
    await writeFile(path.join(anotherPath, "SKILL.md"), "untouched")
    mocks.resolveTarget.mockResolvedValue({
      editorId: "test-editor", label: "Test Editor", scope: "global", contentType: "skill",
      message: null, status: "ready", targetKind: "directory", targetPath, targetExists: false,
    })
    const { writeSynapseSkillDirectory } = await import("../../../src/definitions/editor/shared-skill-directory")
    mocks.prepareSkillDirectory.mockImplementation(writeSynapseSkillDirectory)
    const { EditorInstallCore } = await import("../editor-install-core")
    const detail = {
      id, name: source.name, title: source.title, description: source.description, content: raw,
      latestHistoryDirname: "ver_2", hubPackage: { versionNumber: 2, sourceFingerprint: `sha256:${"b".repeat(64)}` },
      type: "skill", attachments: [], attachmentCount: 0, category: "", icon: "", iconBg: "", createdBy: "", createdAt: "",
      createdByDisplayName: "", modifiedBy: "", modifiedByDisplayName: "", modifiedAt: "", deleted: false,
    } as const
    const readPreparedSkill = vi.fn(async (): Promise<SynapseContentDetail<"skill">> => ({ ...detail, attachments: [] }))
    const core = new EditorInstallCore({
      resolveEditorInstallTarget: mocks.resolveTarget,
      preparedSourceProvider: {
        readPreparedSkill, async readPreparedRule() { throw new Error("not a rule") },
        async beginPreparedInstall() {}, async endPreparedInstall() {}, async copyPreparedSkillAttachment() {},
        async markPreparedInstalled() {},
      },
    })
    return { root, oldPath, targetPath, anotherPath, readPreparedSkill, core,
      payload: { editorId: "test-editor" as never, scope: "global" as const, source, overwriteConfirmed: true } }
  }

  it("moves only the selected same-identity installation and preserves the original package fields", async () => {
    const f = await fixture()
    const installed = await f.core.installSourceToEditor(f.payload)
    await expect(readFile(path.join(f.oldPath, "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe(raw)
    await expect(readFile(path.join(f.anotherPath, "SKILL.md"), "utf8")).resolves.toBe("untouched")
    const backupPath = installed.warning?.split("备份：")[1]
    expect(backupPath).toBeTruthy()
    await expect(readFile(path.join(backupPath!, "SKILL.md"), "utf8")).resolves.toBe("original")
  })

  it("restores the old directory if the new destination appears during the switch", async () => {
    const f = await fixture()
    const original = await f.readPreparedSkill()
    f.readPreparedSkill.mockResolvedValueOnce(original).mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockImplementationOnce(async () => {
        await mkdir(f.targetPath)
        await writeFile(path.join(f.targetPath, "SKILL.md"), "other source")
        return original
      })
    await expect(f.core.installSourceToEditor(f.payload)).rejects.toThrow()
    await expect(readFile(path.join(f.oldPath, "SKILL.md"), "utf8")).resolves.toBe("original")
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe("other source")
  })

  it("rejects forged package fields before any editor strategy runs", async () => {
    const f = await fixture()
    await expect(f.core.installSourceToEditor({ ...f.payload, source: { ...source, description: "forged" } })).rejects.toThrow("不可修改")
    await expect(f.core.installSourceToEditor({ ...f.payload, installFormValues: { name: "forged" } })).rejects.toThrow("来源无效")
    expect(mocks.prepareSkillDirectory).not.toHaveBeenCalled()
  })

  async function conflictFixture(scope: "global" | "project" = "global") {
    const f = await fixture()
    await rm(f.oldPath, { recursive: true })
    await mkdir(f.targetPath)
    await writeFile(path.join(f.targetPath, "SKILL.md"), "old Skill")
    await writeFile(path.join(f.targetPath, "old-only.md"), "old attachment")
    await writeFile(path.join(f.targetPath, ".env"), "TOKEN=old-value\n")
    mocks.resolveTarget.mockResolvedValue({
      editorId: "test-editor", label: "Test Editor", scope, contentType: "skill",
      message: null, status: "conflict", targetKind: "directory",
      targetPath: f.targetPath, conflictContentId: "unknown",
    })
    const projectPath = scope === "project" ? f.root : undefined
    if (projectPath) {
      const config = await configStore.load()
      vi.mocked(configStore.load).mockResolvedValue({
        ...config, global: { ...config.global, projects: [{ id: "project", name: "Project", path: projectPath }] },
      })
    }
    const service = new EditorInstallService()
    const target = await service.resolveEditorInstallTarget({
      editorId: f.payload.editorId, scope, projectPath, contentType: "skill", contentId: id,
    })
    expect(target.status).toBe("conflict")
    if (target.status !== "conflict") throw new Error("expected replaceable conflict")
    service.setPreparedSourceProvider({
      readPreparedSkill: f.readPreparedSkill,
      async readPreparedRule() { throw new Error("not a rule") },
      async readPreparedSkillAttachmentText() { return null },
      async beginPreparedInstall() {},
      async endPreparedInstall() {},
      async copyPreparedSkillAttachment(_sourceId, _contentId, filename, destination) {
        expect(filename).toBe(".env.example")
        await writeFile(destination, "TOKEN=fresh-default\n")
      },
      async markPreparedInstalled() {},
    })
    return { ...f, core: service, payload: {
      ...f.payload, scope, projectPath, replaceConfirmed: true, hubReplacementToken: target.hubReplacementToken,
    } }
  }

  it("replaces the entire conflicting directory only after confirmation", async () => {
    const f = await conflictFixture()
    await expect(f.core.installSourceToEditor({ ...f.payload, replaceConfirmed: false })).rejects.toThrow()
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe("old Skill")
    await f.core.installSourceToEditor(f.payload)
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe(raw)
    for (const filename of ["old-only.md", ".env"]) {
      await expect(readFile(path.join(f.targetPath, filename))).rejects.toMatchObject({ code: "ENOENT" })
    }
  })

  it("restores the old Skill and env when validation fails after moving the directory", async () => {
    const f = await conflictFixture()
    const detail = await f.readPreparedSkill()
    f.readPreparedSkill.mockResolvedValueOnce(detail).mockResolvedValueOnce(detail).mockResolvedValueOnce(detail)
      .mockImplementationOnce(async () => {
        await expect(readFile(path.join(f.targetPath, "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" })
        throw new Error("package became unavailable")
      })
    await expect(f.core.installSourceToEditor(f.payload)).rejects.toThrow("package became unavailable")
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe("old Skill")
    await expect(readFile(path.join(f.targetPath, ".env"), "utf8")).resolves.toBe("TOKEN=old-value\n")
    await expect(readFile(path.join(f.targetPath, "old-only.md"), "utf8")).resolves.toBe("old attachment")
  })

  it("creates a fresh project env from the new package even when the old env has the same key", async () => {
    const f = await conflictFixture("project")
    const detail = await f.readPreparedSkill()
    f.readPreparedSkill.mockResolvedValue({
      ...detail,
      attachmentCount: 1,
      attachments: [{ originalName: ".env.example", sha256: "a".repeat(64), size: 20 }],
    })
    await f.core.installSourceToEditor(f.payload)
    await expect(readFile(path.join(f.targetPath, ".env"), "utf8")).resolves.toBe("TOKEN=fresh-default\n")
    await expect(readFile(path.join(f.targetPath, "old-only.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("requires a new confirmation if a different directory takes the selected path", async () => {
    const f = await conflictFixture()
    await rename(f.targetPath, path.join(f.root, "original"))
    await mkdir(f.targetPath)
    await writeFile(path.join(f.targetPath, "SKILL.md"), "different Skill")
    await expect(f.core.installSourceToEditor(f.payload)).rejects.toThrow("重新确认")
    await expect(readFile(path.join(f.targetPath, "SKILL.md"), "utf8")).resolves.toBe("different Skill")
  })
})
