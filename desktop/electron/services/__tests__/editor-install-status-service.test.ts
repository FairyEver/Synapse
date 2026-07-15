import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseEditorResolvedTarget } from "../../../src/types/editor"
import type { EditorScanProjectEntry, EditorScanResult } from "../../../src/types/editor-scan"

const mocks = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  scanAll: vi.fn(),
  scanSkillDirectories: vi.fn(),
}))

vi.mock("../editor-adapters", () => ({
  editorAdapters: [
    {
      id: "codex",
      label: "Codex",
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["rule", "skill"],
      getScanPathConfig: () => ({
        globalSkillsPath: "/global/skills",
        globalRulesPath: "/global/AGENTS.md",
        rulesSupported: true,
        detectionDir: "/global",
        projectPaths: () => ({ skillsPath: "/project/skills", rulesPath: "/project/AGENTS.md" }),
      }),
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
  scanSkillDirectories: mocks.scanSkillDirectories,
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
    mocks.scanSkillDirectories.mockResolvedValue({ skills: [], duplicateSkillNames: [] })
  })

  it("resolves global Skill installations without scanning projects or rules", async () => {
    mocks.scanSkillDirectories.mockResolvedValue({
      skills: [{
        name: "synapse-skill",
        path: "/global/skills/synapse-skill",
        source: "synapse",
        synapseContentId: "synapse-skill",
        repositoryVersion: "system",
        sourceFingerprint: "sha256:old",
        preview: "Use Synapse MCP tools.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
    })

    const result = await new EditorInstallStatusService().resolveGlobalSkillInstallations({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      sourceFingerprint: "sha256:new",
      projects: [],
    })

    expect(mocks.scanSkillDirectories).toHaveBeenCalledWith(["/global/skills"])
    expect(mocks.scanAll).not.toHaveBeenCalled()
    expect(result.entries).toEqual([
      expect.objectContaining({ editorId: "codex", scope: "global", status: "needs_update" }),
    ])
  })

  it.each([
    {
      name: "matching fingerprint",
      installedContentId: "synapse-skill",
      installedFingerprint: "sha256:current",
      expectedStatus: "installed",
    },
    {
      name: "legacy built-in without fingerprint",
      installedContentId: "builtin__skill__synapse-skill",
      installedFingerprint: undefined,
      expectedStatus: "needs_update",
    },
    {
      name: "external same-name Skill",
      installedContentId: null,
      installedFingerprint: undefined,
      expectedStatus: "external_same_name",
    },
  ])("classifies a global installation with $name", async ({
    installedContentId,
    installedFingerprint,
    expectedStatus,
  }) => {
    mocks.scanSkillDirectories.mockResolvedValue({
      skills: [{
        name: "synapse-skill",
        path: "/global/skills/synapse-skill",
        source: installedContentId ? "synapse" : "external",
        synapseContentId: installedContentId,
        repositoryVersion: null,
        sourceFingerprint: installedFingerprint,
        preview: "Use Synapse MCP tools.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
    })

    const result = await new EditorInstallStatusService().resolveGlobalSkillInstallations({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      sourceFingerprint: "sha256:current",
      projects: [],
    })

    expect(result.entries[0]?.status).toBe(expectedStatus)
  })

  it("marks only the editor unavailable when its Skill root cannot be scanned", async () => {
    mocks.scanSkillDirectories.mockResolvedValue({
      skills: [],
      duplicateSkillNames: [],
      skillScanError: "Skill 目录读取失败",
    })

    const result = await new EditorInstallStatusService().resolveGlobalSkillInstallations({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      sourceFingerprint: "sha256:current",
      projects: [],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      status: "unavailable",
      message: expect.stringContaining("Codex 全局 Skill 检测失败"),
    }))
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

  it("marks a Synapse Skill with a different fingerprint as needing update", async () => {
    mocks.scanAll.mockResolvedValue({
      global: [{
        editorId: "codex",
        editorLabel: "Codex",
        status: "detected",
        rules: [],
        rulesSupported: true,
        skills: [{
          name: "synapse-skill",
          path: "/global/skills/synapse-skill",
          source: "synapse",
          synapseContentId: "synapse-skill",
          repositoryVersion: null,
          sourceFingerprint: "sha256:old",
          preview: "Use Synapse MCP tools.",
          fileCount: 2,
          trash: { mode: "path" },
        }],
        duplicateSkillNames: [],
      }],
      projects: [],
    })

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      sourceFingerprint: "sha256:new",
      projects: [],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      scope: "global",
      status: "needs_update",
    }))
  })

  it("marks an old Synapse Skill without fingerprint as needing update", async () => {
    mocks.scanAll.mockResolvedValue({
      global: [{
        editorId: "codex",
        editorLabel: "Codex",
        status: "detected",
        rules: [],
        rulesSupported: true,
        skills: [{
          name: "synapse-skill",
          path: "/global/skills/synapse-skill",
          source: "synapse",
          synapseContentId: "builtin__skill__synapse-skill",
          repositoryVersion: null,
          preview: "Use Synapse MCP tools.",
          fileCount: 2,
          trash: { mode: "path" },
        }],
        duplicateSkillNames: [],
      }],
      projects: [],
    })

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "synapse-skill",
      contentName: "synapse-skill",
      title: "Synapse Skill",
      sourceFingerprint: "sha256:new",
      projects: [],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      scope: "global",
      status: "needs_update",
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
