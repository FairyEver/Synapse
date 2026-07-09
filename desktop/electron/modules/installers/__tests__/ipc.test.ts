import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  installSourceToEditor: vi.fn(),
  installSourceToEditorTargets: vi.fn(),
  prepareInlineRuleSource: vi.fn(),
  prepareLocalSkillSource: vi.fn(),
}))

vi.mock("../../../services/editor-install-service", () => ({
  editorInstallService: {
    installSourceToEditor: mocks.installSourceToEditor,
    installSourceToEditorTargets: mocks.installSourceToEditorTargets,
  },
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: {
    refresh: vi.fn(async () => []),
  },
}))

vi.mock("../../../services/installer-source-service", () => ({
  installerSourceService: {
    prepareInlineRuleSource: mocks.prepareInlineRuleSource,
    prepareLocalSkillSource: mocks.prepareLocalSkillSource,
  },
}))

import { installersIpcModule } from "../ipc"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareInlineRuleSource.mockResolvedValue({
    kind: "rule",
    origin: "inline",
    sourceIdentity: "inline-rule:abc",
    inlineSourceId: "source-1",
    name: "team.rule",
    body: "# Rule",
  })
  mocks.prepareLocalSkillSource.mockResolvedValue({
    kind: "skill",
    origin: "local-directory",
    sourceIdentity: "local-skill:abc",
    localSourceId: "source-2",
    name: "team-skill",
    description: "",
    mainContent: "# Skill",
  })
  mocks.installSourceToEditor.mockResolvedValue({
    editorId: "codex",
    label: "Codex",
    scope: "global",
    contentType: "rule",
    contentId: "inline-rule:abc",
    targetKind: "file",
    targetPath: "/tmp/rules/team.rule.md",
  })
  mocks.installSourceToEditorTargets.mockResolvedValue({
    results: [{
      target: { editorId: "codex", scope: "global" },
      status: "installed",
      result: {
        editorId: "codex",
        label: "Codex",
        scope: "global",
        contentType: "skill",
        contentId: "synapse-skill",
        targetKind: "directory",
        targetPath: "/Users/test/.agents/skills/synapse-skill",
      },
    }],
  })
})

describe("installersIpcModule", () => {
  it("prepares inline Rule sources through the service", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:installers:prepare-inline-rule-source", {
      name: "team.rule",
      body: "# Rule",
    })

    expect(result).toMatchObject({ name: "team.rule" })
    expect(mocks.prepareInlineRuleSource).toHaveBeenCalledWith({
      name: "team.rule",
      body: "# Rule",
    })
  })

  it("prepares local Skill sources through the service", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:installers:prepare-local-skill-source", {
      sourceDirectoryPath: "/tmp/skill",
    })

    expect(result).toMatchObject({ name: "team-skill" })
    expect(mocks.prepareLocalSkillSource).toHaveBeenCalledWith({
      sourceDirectoryPath: "/tmp/skill",
    })
  })

  it("rejects empty and extra fields", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:installers:prepare-local-skill-source", {
      sourceDirectoryPath: "",
    })).rejects.toThrow()
    await expect(harness.invoke("synapse:installers:prepare-inline-rule-source", {
      name: "team.rule",
      body: "# Rule",
      rawPath: "/tmp/secret",
    })).rejects.toThrow()

    expect(mocks.prepareLocalSkillSource).not.toHaveBeenCalled()
    expect(mocks.prepareInlineRuleSource).not.toHaveBeenCalled()
  })

  it("installs prepared installer sources through the content install service", async () => {
    const harness = createHarness()

    await harness.invoke("synapse:installers:install-source-to-editor", {
      editorId: "codex",
      scope: "global",
      source: {
        kind: "rule",
        origin: "inline",
        sourceIdentity: "inline-rule:abc",
        inlineSourceId: "source-1",
        name: "team.rule",
        body: "# Rule",
      },
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        editorId: "codex",
        source: expect.objectContaining({ sourceIdentity: "inline-rule:abc" }),
      }),
      expect.objectContaining({
        actor: { kind: "user" },
      }),
    )
  })

  it("routes batch source installs to the editor install service", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:installers:install-source-to-editor-targets", {
      mode: "install",
      source: {
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        name: "synapse-skill",
        title: "Synapse Skill",
        description: "Synapse MCP 使用指南",
        preparedSourceId: "synapse-skill:test",
        mainContent: "# Synapse Skill",
        sourceFingerprint: "sha256:test",
      },
      targets: [{ editorId: "codex", scope: "global" }],
    })

    expect(result.results).toHaveLength(1)
    expect(mocks.installSourceToEditorTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "install",
        targets: [{ editorId: "codex", scope: "global" }],
      }),
      expect.objectContaining({
        actor: { kind: "user" },
      }),
    )
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(installersIpcModule, {
    moduleId: "installers",
    resolve: <T,>(_serviceId: string): T => {
      if (_serviceId === "core.audit-sink") return { record: vi.fn() } as T
      if (_serviceId === "core.permission-guard") return { check: vi.fn(async () => ({ allowed: true })) } as T
      if (_serviceId === "core.event-bus") return { emit: vi.fn() } as T
      throw new Error("installer source IPC should not resolve broad services")
    },
  })
  return harness
}
