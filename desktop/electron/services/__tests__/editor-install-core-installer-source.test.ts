import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getContent: vi.fn(),
  getGlobalRulesPath: vi.fn(),
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

import { ContentInstallService } from "../content-install-service"
import { installerSourceService } from "../installer-source-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-installer-source-"))
  tempRoots.push(root)
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getGlobalRulesPath.mockReturnValue(null)
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
    const service = new ContentInstallService()

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
})
