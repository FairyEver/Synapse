import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAttachmentFile: vi.fn(),
  getContent: vi.fn(),
  getSkillDetail: vi.fn(),
  getGlobalRulesPath: vi.fn(),
  getRepositoryState: vi.fn(),
  loadConfig: vi.fn(),
  prepareRuleFileContent: vi.fn(),
  prepareSkillDirectory: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-prepared-source-${name}`),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../content-service", () => ({
  contentService: {
    getAttachmentFile: mocks.getAttachmentFile,
    getContent: mocks.getContent,
    getSkillDetail: mocks.getSkillDetail,
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
    load: mocks.loadConfig,
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: {
    getRepositoryState: mocks.getRepositoryState,
  },
}))

function defaultConfig() {
  return {
      activeRepoUuid: null,
      repositories: [],
      global: { projects: [] },
    }
}

import { EditorInstallService } from "../editor-install-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-prepared-install-"))
  tempRoots.push(root)
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getGlobalRulesPath.mockReturnValue(null)
  mocks.loadConfig.mockResolvedValue(defaultConfig())
})

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("EditorInstallService prepared source", () => {
  it("reads a prepared Rule while preserving the existing editor install strategy", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "rules", "store-rule.md")
    mocks.getGlobalRulesPath.mockReturnValue(path.join(root, "rules"))
    const provider = {
      readPreparedRule: vi.fn().mockResolvedValue("# Store Rule\n"),
      readPreparedSkill: vi.fn(),
      beginPreparedInstall: vi.fn(),
      endPreparedInstall: vi.fn(),
      copyPreparedSkillAttachment: vi.fn(),
      readPreparedSkillAttachmentText: vi.fn(),
      markPreparedInstalled: vi.fn(),
    }
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
    mocks.prepareRuleFileContent.mockResolvedValue("---\ninstalled: true\n---\n# Store Rule\n")
    const service = new EditorInstallService({ preparedSourceProvider: provider })

    await service.installToEditor({
      editorId: "test-editor",
      scope: "global",
      contentType: "rule",
      contentId: "content-1",
      preparedSourceId: "prepared-1",
    })

    expect(provider.readPreparedRule).toHaveBeenCalledWith("prepared-1", "content-1")
    expect(mocks.getContent).not.toHaveBeenCalled()
    expect(mocks.prepareRuleFileContent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        contentId: "content-1",
        contentType: "rule",
      }),
      ruleBody: "# Store Rule\n",
    }))
    await expect(readFile(targetPath, "utf8")).resolves.toBe("---\ninstalled: true\n---\n# Store Rule\n")
  })

  it("installs a validated prepared Skill through the editor strategy and atomic replacement path", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "store-skill")
    const provider = {
      readPreparedRule: vi.fn(),
      readPreparedSkill: vi.fn().mockResolvedValue({
        id: "content-1",
        type: "skill",
        title: "Store Skill",
        description: "",
        category: "skill-repository",
        icon: "",
        iconBg: "",
        createdBy: "skill-repository",
        createdByDisplayName: "Skill Repository",
        createdAt: "1970-01-01T00:00:00.000Z",
        modifiedBy: "skill-repository",
        modifiedByDisplayName: "Skill Repository",
        modifiedAt: "1970-01-01T00:00:00.000Z",
        deleted: false,
        latestHistoryDirname: "version-1",
        attachmentCount: 1,
        content: "# Store Skill\n",
        attachments: [{ originalName: "assets/icon.bin", sha256: "a".repeat(64), size: 4 }],
      }),
      beginPreparedInstall: vi.fn(),
      endPreparedInstall: vi.fn(),
      copyPreparedSkillAttachment: vi.fn(async (
        _sourceId: string,
        _contentId: string,
        _relativePath: string,
        attachmentTargetPath: string,
      ) => {
        await mkdir(path.dirname(attachmentTargetPath), { recursive: true })
        await writeFile(attachmentTargetPath, "icon")
      }),
      readPreparedSkillAttachmentText: vi.fn(),
      markPreparedInstalled: vi.fn(),
    }
    mocks.prepareSkillDirectory.mockImplementation(async ({
      copyAttachment,
      detail,
      stagingDirectoryPath,
      writeTextFile,
    }) => {
      await writeTextFile(path.join(stagingDirectoryPath, "SKILL.md"), `prepared\n${detail.content}`)
      await copyAttachment(detail.attachments[0]!, path.join(stagingDirectoryPath, "references", "icon.bin"))
    })
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
    const service = new EditorInstallService({ preparedSourceProvider: provider })

    await service.installToEditor({
      editorId: "test-editor",
      scope: "global",
      contentType: "skill",
      contentId: "content-1",
      preparedSourceId: "prepared-1",
    })

    expect(provider.readPreparedSkill).toHaveBeenCalledWith("prepared-1", "content-1")
    expect(mocks.getSkillDetail).not.toHaveBeenCalled()
    expect(mocks.prepareSkillDirectory).toHaveBeenCalled()
    expect(provider.copyPreparedSkillAttachment).toHaveBeenCalledWith(
      "prepared-1",
      "content-1",
      "assets/icon.bin",
      expect.stringContaining(path.join("references", "icon.bin")),
    )
    expect(provider.markPreparedInstalled).toHaveBeenCalledWith("prepared-1", "content-1")
    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8")).resolves.toBe("prepared\n# Store Skill\n")
    await expect(readFile(path.join(targetPath, "references", "icon.bin"), "utf8")).resolves.toBe("icon")
  })

  it("rejects a prepared Skill containing a root runtime .ENV before adapter preparation", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "unsafe-prepared")
    const provider = {
      readPreparedRule: vi.fn(),
      readPreparedSkill: vi.fn().mockResolvedValue({
        id: "content-unsafe",
        type: "skill",
        title: "Unsafe Skill",
        description: "",
        category: "skill-repository",
        icon: "",
        iconBg: "",
        createdBy: "skill-repository",
        createdByDisplayName: "Skill Repository",
        createdAt: "1970-01-01T00:00:00.000Z",
        modifiedBy: "skill-repository",
        modifiedByDisplayName: "Skill Repository",
        modifiedAt: "1970-01-01T00:00:00.000Z",
        deleted: false,
        latestHistoryDirname: "version-1",
        attachmentCount: 1,
        content: "# Unsafe Skill\n",
        attachments: [{ originalName: ".ENV", sha256: "a".repeat(64), size: 4 }],
      }),
      beginPreparedInstall: vi.fn(),
      endPreparedInstall: vi.fn(),
      copyPreparedSkillAttachment: vi.fn(),
      readPreparedSkillAttachmentText: vi.fn(),
      markPreparedInstalled: vi.fn(),
    }
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
    const service = new EditorInstallService({ preparedSourceProvider: provider })

    await expect(service.installToEditor({
      editorId: "test-editor",
      scope: "global",
      contentType: "skill",
      contentId: "content-unsafe",
      preparedSourceId: "prepared-unsafe",
    })).rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")

    expect(mocks.prepareSkillDirectory).not.toHaveBeenCalled()
    expect(provider.copyPreparedSkillAttachment).not.toHaveBeenCalled()
  })

  it("rejects a repository Skill containing a root runtime .env before adapter preparation", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skills", "unsafe-repository")
    mocks.loadConfig.mockResolvedValue({
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        localPath: root,
        contentDirs: { skill: "skills" },
      }],
      global: { projects: [] },
    })
    mocks.getRepositoryState.mockResolvedValue({
      repositoryUuid: "repo-1",
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    mocks.getSkillDetail.mockResolvedValue({
      id: "repository-unsafe",
      type: "skill",
      title: "Unsafe Skill",
      description: "",
      category: "test",
      icon: "",
      iconBg: "",
      createdBy: "user",
      createdByDisplayName: "User",
      createdAt: "1970-01-01T00:00:00.000Z",
      modifiedBy: "user",
      modifiedByDisplayName: "User",
      modifiedAt: "1970-01-01T00:00:00.000Z",
      deleted: false,
      latestHistoryDirname: "version-1",
      attachmentCount: 1,
      content: "# Unsafe Skill\n",
      attachments: [{ originalName: ".env", sha256: "b".repeat(64), size: 4 }],
    })
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
    const service = new EditorInstallService()

    await expect(service.installToEditor({
      editorId: "test-editor",
      scope: "global",
      contentType: "skill",
      contentId: "repository-unsafe",
    })).rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")

    expect(mocks.prepareSkillDirectory).not.toHaveBeenCalled()
  })

  it("inspects a prepared Skill through the selected provider", async () => {
    const provider = {
      hasPreparedSource: vi.fn().mockReturnValue(true),
      readPreparedRule: vi.fn(),
      readPreparedSkill: vi.fn().mockResolvedValue({
        content: "Token: ${{ LEGACY_TOKEN }}",
      }),
      readPreparedSkillAttachmentText: vi.fn().mockResolvedValue("TOKEN=default\n"),
      beginPreparedInstall: vi.fn(),
      endPreparedInstall: vi.fn(),
      copyPreparedSkillAttachment: vi.fn(),
      markPreparedInstalled: vi.fn(),
    }
    const service = new EditorInstallService()
    service.addPreparedSourceProvider(provider)
    const source = {
      kind: "skill" as const,
      origin: "prepared" as const,
      sourceIdentity: "content-1",
      name: "store-skill",
      preparedSourceId: "prepared-1",
    }

    await expect(service.inspectSkillEnvSource(source)).resolves.toEqual({
      declarations: [{ name: "TOKEN", defaultValue: "default" }],
      legacyPlaceholders: ["LEGACY_TOKEN"],
    })
    expect(provider.readPreparedSkill).toHaveBeenCalledWith("prepared-1", "content-1")
    expect(provider.readPreparedSkillAttachmentText)
      .toHaveBeenCalledWith("prepared-1", "content-1", ".env.example")
  })

  it("inspects a repository Skill at its latest history version", async () => {
    mocks.getSkillDetail.mockResolvedValue({
      content: "# Skill\n",
      latestHistoryDirname: "history-1",
    })
    mocks.getAttachmentFile.mockResolvedValue({
      kind: "text",
      content: "TOKEN=repository-default\n",
    })
    const service = new EditorInstallService()
    const source = {
      kind: "skill" as const,
      origin: "repository" as const,
      sourceIdentity: "skill-1",
      repositoryContentId: "skill-1",
      name: "repository-skill",
    }

    await expect(service.inspectSkillEnvSource(source)).resolves.toEqual({
      declarations: [{ name: "TOKEN", defaultValue: "repository-default" }],
      legacyPlaceholders: [],
    })
    expect(mocks.getAttachmentFile)
      .toHaveBeenCalledWith("skill", "skill-1", "history-1", ".env.example")
  })
})
