import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseInstallToEditorPayload } from "../../../src/types/editor"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../runtime/security"

const mocks = vi.hoisted(() => ({
  configLoad: vi.fn(),
  prepareRuleFileContent: vi.fn(),
  readRuleProjectFormValues: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-install-path-test-${which}`,
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
    getSkillDetail: vi.fn(),
  },
}))

vi.mock("../definitions/generated/main-registry", () => ({
  editorAdapterById: new Map([
    ["test-editor", {
      id: "test-editor",
      label: "Test Editor",
      order: 1,
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["rule", "skill"],
      resolveGlobalDirectoryPaths: () => ({
        rulesPath: "/tmp/synapse-test-editor/rules",
        skillsPath: "/tmp/synapse-test-editor/skills",
      }),
      getScanPathConfig: () => ({
        detectionDir: ".test-editor",
        globalRulesPath: "/tmp/synapse-test-editor/rules",
        globalSkillsPath: "/tmp/synapse-test-editor/skills",
        projectPaths: (projectPath: string) => ({
          rulesPath: path.join(projectPath, ".test-editor", "rules"),
          skillsPath: path.join(projectPath, ".test-editor", "skills"),
        }),
        rulesSupported: true,
      }),
    }],
  ]),
  editorInstallStrategyById: new Map([
    ["test-editor", {
      prepareRuleFileContent: mocks.prepareRuleFileContent,
      readRuleProjectFormValues: mocks.readRuleProjectFormValues,
    }],
  ]),
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: mocks.configLoad,
  },
}))

import { editorInstallService } from "../editor-install-service"
import { contentService } from "../content-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-install-path-"))
  tempRoots.push(root)
  return root
}

function mockConfiguredProjects(paths: string[]) {
  mocks.configLoad.mockResolvedValue({
    activeRepoUuid: null,
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
    },
    global: {
      contentSortOrder: "modified-desc",
      favorites: { prompt: [], rule: [], skill: [] },
      projects: paths.map((projectPath, index) => ({
        id: `project-${index + 1}`,
        name: `Project ${index + 1}`,
        path: projectPath,
      })),
      recentlyViewed: { prompt: [], rule: [], skill: [] },
      themeMode: "system",
    },
    repositories: [],
  })
}

describe("EditorInstallService path security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareRuleFileContent.mockImplementation(async ({ ruleBody }: { ruleBody: string }) => ruleBody)
    mockConfiguredProjects([])
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("rejects project installs whose projectPath is not configured", async () => {
    const configuredRoot = await createTempRoot()
    const rogueRoot = await createTempRoot()
    mockConfiguredProjects([configuredRoot])
    mocks.resolveTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "test-editor",
      label: "Test Editor",
      message: null,
      scope: "project",
      status: "ready",
      targetExists: false,
      targetKind: "directory",
      targetPath: path.join(rogueRoot, ".test-editor", "skills", "test-skill"),
    })

    const payload: SynapseInstallToEditorPayload = {
      contentId: "skill-1",
      contentType: "skill",
      editorId: "test-editor",
      projectPath: rogueRoot,
      scope: "project",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("项目路径不在已配置项目中。")

    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it("rejects install form reads outside configured editor rule roots", async () => {
    const configuredRoot = await createTempRoot()
    const rogueRoot = await createTempRoot()
    mockConfiguredProjects([configuredRoot])
    mocks.readRuleProjectFormValues.mockResolvedValue({ description: "leaked" })

    await expect(editorInstallService.readEditorInstallFormValues({
      editorId: "test-editor",
      targetPath: path.join(rogueRoot, "secret.md"),
    })).rejects.toThrow("安装目标不在已配置编辑器路径中。")

    expect(mocks.readRuleProjectFormValues).not.toHaveBeenCalled()
  })

  it("rejects Rule install targets outside configured editor rule roots", async () => {
    const configuredRoot = await createTempRoot()
    mockConfiguredProjects([configuredRoot])
    vi.mocked(contentService.getContent).mockResolvedValue({
      content: "# Escaped Rule\n",
    } as Awaited<ReturnType<typeof contentService.getContent>>)
    mocks.resolveTarget.mockResolvedValue({
      contentType: "rule",
      editorId: "test-editor",
      label: "Test Editor",
      message: null,
      scope: "project",
      status: "ready",
      targetExists: false,
      targetKind: "file",
      targetPath: path.join(configuredRoot, ".test-editor", "settings.md"),
    })

    const payload: SynapseInstallToEditorPayload = {
      contentId: "foo/../../settings",
      contentType: "rule",
      editorId: "test-editor",
      projectPath: configuredRoot,
      scope: "project",
    }

    await expect(editorInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: new InMemoryAuditSink(),
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("安装目标不在已配置编辑器路径中。")

    expect(contentService.getContent).not.toHaveBeenCalled()
  })
})
