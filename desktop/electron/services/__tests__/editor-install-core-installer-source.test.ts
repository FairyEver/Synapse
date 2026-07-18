import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
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
