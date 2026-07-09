import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseEditorResolvedTarget } from "../../../src/types/editor"
import type { EditorScanProjectEntry, EditorScanResult } from "../../../src/types/editor-scan"

const mocks = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  scanAll: vi.fn(),
}))

vi.mock("../editor-adapters", () => ({
  editorAdapters: [
    {
      id: "codex",
      label: "Codex",
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["rule", "skill"],
    },
  ],
}))

vi.mock("../editor-adapter-service", () => ({
  editorAdapterService: {
    resolveTarget: mocks.resolveTarget,
  },
}))

vi.mock("../editor-scan-service", () => ({
  scanAll: mocks.scanAll,
}))

import { EditorInstallStatusService } from "../editor-install-status-service"

function createReadyTarget(payload: {
  scope: "global" | "project"
  contentType: "rule" | "skill"
  projectPath?: string
}): SynapseEditorResolvedTarget {
  const basePath = payload.scope === "project" ? payload.projectPath ?? "/project" : "/global"
  return {
    editorId: "codex",
    label: "Codex",
    scope: payload.scope,
    contentType: payload.contentType,
    message: null,
    status: "ready",
    targetExists: true,
    targetKind: payload.contentType === "rule" ? "file" : "directory",
    targetPath: payload.contentType === "rule" ? `${basePath}/AGENTS.md` : `${basePath}/skills/review`,
  }
}

function createScan(editor: EditorScanProjectEntry): EditorScanResult {
  return {
    global: [],
    projects: [
      {
        projectName: "Project",
        projectPath: "/project",
        pathExists: true,
        editors: [editor],
      },
    ],
  }
}

describe("EditorInstallStatusService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTarget.mockImplementation(createReadyTarget)
  })

  it("marks a Codex project rule with the same synapse content id and content as installed", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      skills: [],
      rules: [{
        name: "AGENTS.md",
        path: "/project/AGENTS.md",
        source: "synapse",
        synapseContentId: "rule-1",
        preview: "Keep it tight.",
        metadata: {},
        content: "Keep it tight.\n",
        trash: { mode: "rule-section", ruleId: "rule-1" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "rule",
      contentId: "rule-1",
      contentName: "AGENTS.md",
      content: "Keep it tight.",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      scope: "project",
      projectId: "project-1",
      status: "installed",
      targetPath: "/project/AGENTS.md",
    }))
  })

  it("marks a Codex project rule with the same synapse content id but different content as needing update", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      skills: [],
      rules: [{
        name: "AGENTS.md",
        path: "/project/AGENTS.md",
        source: "synapse",
        synapseContentId: "rule-1",
        preview: "Old text.",
        metadata: {},
        content: "Old text.",
        trash: { mode: "rule-section", ruleId: "rule-1" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "rule",
      contentId: "rule-1",
      contentName: "AGENTS.md",
      content: "New text.",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "needs_update",
      targetPath: "/project/AGENTS.md",
    }))
  })

  it("marks a Codex project skill with the same .synapse content id as installed", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "synapse",
        synapseContentId: "skill-1",
        repositoryVersion: null,
        preview: "Review carefully.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "installed",
      targetPath: "/project/skills/review",
    }))
  })

  it("marks a legacy built-in Synapse Skill id as the current Synapse Skill installation", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "synapse-skill",
        path: "/project/.agents/skills/synapse-skill",
        source: "synapse",
        synapseContentId: "builtin__skill__synapse-skill",
        repositoryVersion: "builtin-current",
        preview: "Use Synapse MCP tools.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "installed",
    }))
  })

  it("marks a Codex project skill with an older repository version as needing update", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "synapse",
        synapseContentId: "skill-1",
        repositoryVersion: "old-version",
        preview: "Review carefully.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      repositoryVersion: "current-version",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "needs_update",
      targetPath: "/project/skills/review",
    }))
  })

  it("keeps legacy installed skills without repository version as installed", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "synapse",
        synapseContentId: "skill-1",
        repositoryVersion: null,
        preview: "Review carefully.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      repositoryVersion: "current-version",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "installed",
    }))
  })

  it("marks a Codex project skill with the same name and no synapse content id as an external same-name item", async () => {
    mocks.scanAll.mockResolvedValue(createScan({
      editorId: "codex",
      editorLabel: "Codex",
      rules: [],
      skills: [{
        name: "review",
        path: "/project/.codex/skills/review",
        source: "external",
        synapseContentId: null,
        repositoryVersion: null,
        preview: "External review skill.",
        fileCount: 1,
        trash: { mode: "path" },
      }],
    }))

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "review",
      title: "Review",
      projects: [{ id: "project-1", name: "Project", path: "/project" }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      scope: "project",
      projectId: "project-1",
      status: "external_same_name",
      targetPath: "/project/skills/review",
    }))
  })
})
