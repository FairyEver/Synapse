import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EditorScanResult } from "../../../src/types/editor-scan"

const mocks = vi.hoisted(() => ({
  scanAll: vi.fn(),
}))

vi.mock("../editor-scan-service", () => ({
  scanAll: mocks.scanAll,
  trashScanItem: vi.fn(),
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
        repositoryVersion: null,
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
          repositoryVersion: null,
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
  })

  it("builds list status entries from global and project scans", async () => {
    mocks.scanAll.mockResolvedValue(createScan())

    await installStatusCacheService.buildCache()

    expect(installStatusCacheService.getAll()).toMatchObject({
      "global-skill": [{
        editorId: "codex",
        scope: "global",
      }],
      "project-skill": [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
      }],
      "project-rule": [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
      }],
    })
  })

  it("refreshes a single content id from project scans", async () => {
    mocks.scanAll.mockResolvedValue(createScan())

    const entries = await installStatusCacheService.refresh("project-skill")

    expect(entries).toEqual([{
      editorId: "codex",
      projectName: "Project",
      projectPath: "/project",
      scope: "project",
    }])
    expect(installStatusCacheService.getForContent("project-skill")).toEqual(entries)
  })
})
