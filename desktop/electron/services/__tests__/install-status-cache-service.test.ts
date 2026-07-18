import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EditorScanResult } from "../../../src/types/editor-scan"

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  listContent: vi.fn(),
  scanAll: vi.fn(),
  scanGlobalEditorById: vi.fn(),
}))

vi.mock("../editor-scan-service", () => ({
  scanAll: mocks.scanAll,
  scanGlobalEditorById: mocks.scanGlobalEditorById,
  trashScanItem: vi.fn(),
}))

vi.mock("../content-service", () => ({
  contentService: {
    getDetail: mocks.getDetail,
    listContent: mocks.listContent,
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

import { installStatusCacheService } from "../install-status-cache-service"

function createScan(): EditorScanResult {
  return {
    global: [{
      editorId: "codex",
      editorLabel: "Codex",
      status: "detected",
      skills: [{
        name: "global-skill",
        path: "/global/skills/global-skill",
        source: "synapse",
        synapseContentId: "global-skill",
        repositoryVersion: "old-version",
        preview: "",
        fileCount: 1,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
      rules: [],
      rulesSupported: true,
    }],
    projects: [{
      projectName: "Project",
      projectPath: "/project",
      pathExists: true,
      editors: [{
        editorId: "codex",
        editorLabel: "Codex",
        skills: [{
          name: "project-skill",
          path: "/project/.codex/skills/project-skill",
          source: "synapse",
          synapseContentId: "project-skill",
          repositoryVersion: "project-current",
          preview: "",
          fileCount: 1,
          trash: { mode: "path" },
        }],
        rules: [{
          name: "AGENTS.md",
          path: "/project/AGENTS.md",
          source: "synapse",
          synapseContentId: "project-rule",
          preview: "",
          content: "current rule body",
          metadata: {},
          trash: { mode: "rule-section", ruleId: "project-rule" },
        }],
      }],
    }],
  }
}

describe("installStatusCacheService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listContent.mockImplementation(async (contentType: string) => {
      if (contentType === "rule") {
        return [{
          id: "project-rule",
          latestHistoryDirname: "rule-current",
          type: "rule",
        }]
      }
      return [{
        id: "global-skill",
        latestHistoryDirname: "current-version",
        type: "skill",
      }, {
        id: "project-skill",
        latestHistoryDirname: "project-current",
        type: "skill",
      }]
    })
    mocks.getDetail.mockResolvedValue({
      id: "project-rule",
      content: "current rule body",
      type: "rule",
    })
  })

  it("builds list status entries from global and project scans", async () => {
    mocks.scanAll.mockResolvedValue(createScan())

    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.getAll()).toMatchObject({
      "global-skill": [{
        editorId: "codex",
        scope: "global",
        status: "needs_update",
      }],
      "project-skill": [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
        status: "installed",
      }],
      "project-rule": [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
        status: "installed",
      }],
    })
  })

  it("treats installed skills without repositoryVersion as installed", async () => {
    const scan = createScan()
    scan.global[0]!.skills[0]!.repositoryVersion = null
    mocks.scanAll.mockResolvedValue(scan)

    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.getAll()["global-skill"]).toEqual([{
      editorId: "codex",
      scope: "global",
      status: "installed",
    }])
  })

  it("marks installed rules as needing update when scanned content differs from current content", async () => {
    const scan = createScan()
    scan.projects[0]!.editors[0]!.rules[0]!.content = "old rule body"
    mocks.scanAll.mockResolvedValue(scan)

    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.getAll()["project-rule"]).toEqual([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
      status: "needs_update",
    }])
  })

  it("refreshes a single content id from project scans", async () => {
    mocks.scanAll.mockResolvedValue(createScan())

    const entries = await installStatusCacheService.refresh("project-skill")

    expect(entries).toEqual([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
      status: "installed",
    }])
    expect(installStatusCacheService.getForContent("project-skill")).toEqual(entries)
  })

  it("refreshes one global editor without scanning configured projects", async () => {
    mocks.scanAll.mockResolvedValue(createScan())
    await installStatusCacheService.buildCache()
    mocks.scanAll.mockClear()
    mocks.scanGlobalEditorById.mockResolvedValue({
      ...createScan().global[0],
      skills: [],
    })

    const entries = await installStatusCacheService.refreshGlobal("global-skill", "codex")

    expect(entries).toEqual([])
    expect(mocks.scanGlobalEditorById).toHaveBeenCalledWith("codex")
    expect(mocks.scanAll).not.toHaveBeenCalled()
  })

  it("removes one global editor entry without discarding project installs", async () => {
    mocks.scanAll.mockResolvedValue(createScan())
    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.removeGlobalEntry("global-skill", "codex")).toEqual([])
    expect(installStatusCacheService.getForContent("global-skill")).toEqual([])
    expect(installStatusCacheService.removeGlobalEntry("project-skill", "codex")).toEqual([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
      status: "installed",
    }])
  })
})
