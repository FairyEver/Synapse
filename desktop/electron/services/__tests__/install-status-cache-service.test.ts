import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EditorScanResult } from "../../../src/types/editor-scan"

const mocks = vi.hoisted(() => ({
  listContent: vi.fn(),
  scanAll: vi.fn(),
}))

vi.mock("../editor-scan-service", () => ({
  scanAll: mocks.scanAll,
  trashScanItem: vi.fn(),
}))

vi.mock("../content-service", () => ({
  contentService: {
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
    mocks.listContent.mockResolvedValue([{
      id: "global-skill",
      latestHistoryDirname: "current-version",
      type: "skill",
    }, {
      id: "project-skill",
      latestHistoryDirname: "project-current",
      type: "skill",
    }])
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
})
