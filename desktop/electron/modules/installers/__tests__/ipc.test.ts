import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryHarness } from "../../../runtime/ipc"
import type { SynapseInstallSourceToEditorTargetsResult } from "../../../../src/types/installers"

const mocks = vi.hoisted(() => ({
  installSourceToEditor: vi.fn(),
  installSourceToEditorTargets: vi.fn(),
  inspectGlobalSkillInstallations: vi.fn(),
  inspectSkillEnvSource: vi.fn(),
  prepareInlineRuleSource: vi.fn(),
  prepareLocalSkillSource: vi.fn(),
  releaseSource: vi.fn(),
  secretGet: vi.fn(),
  permissionCheck: vi.fn(),
  auditRecord: vi.fn(),
}))

vi.mock("../../../services/editor-install-service", () => ({
  editorInstallService: {
    installSourceToEditor: mocks.installSourceToEditor,
    installSourceToEditorTargets: mocks.installSourceToEditorTargets,
    inspectGlobalSkillInstallations: mocks.inspectGlobalSkillInstallations,
    inspectSkillEnvSource: mocks.inspectSkillEnvSource,
  },
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: {
    refresh: vi.fn(async () => []),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../../../services/installer-source-service", () => ({
  installerSourceService: {
    prepareInlineRuleSource: mocks.prepareInlineRuleSource,
    prepareLocalSkillSource: mocks.prepareLocalSkillSource,
    releaseSource: mocks.releaseSource,
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
  mocks.inspectSkillEnvSource.mockResolvedValue({
    declarations: [{ name: "GITEE_TOKEN", defaultValue: "" }],
    legacyPlaceholders: ["INLINE_TOKEN"],
  })
  mocks.inspectGlobalSkillInstallations.mockResolvedValue({ entries: [] })
  mocks.secretGet.mockImplementation(async ({ name }: { name: string }) => ({
    id: `secret-${name}`,
    name,
    hasValue: true,
    value: `${name.toLowerCase()}-value`,
  }))
  mocks.permissionCheck.mockResolvedValue({ allowed: true })
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

  it("inspects Skill ENV declarations through the service", async () => {
    const harness = createHarness()
    const source = {
      kind: "skill",
      origin: "repository",
      sourceIdentity: "skill-1",
      repositoryContentId: "skill-1",
      name: "team-skill",
    }

    const result = await harness.invoke("synapse:installers:inspect-skill-env-source", source)

    expect(result).toEqual({
      declarations: [{ name: "GITEE_TOKEN", defaultValue: "" }],
      legacyPlaceholders: ["INLINE_TOKEN"],
    })
    expect(mocks.inspectSkillEnvSource).toHaveBeenCalledWith(source)
  })

  it("inspects global Skill installations through the public installer method", async () => {
    const harness = createHarness()
    const source = {
      kind: "skill",
      origin: "prepared",
      sourceIdentity: "synapse-skill",
      preparedSourceId: "synapse-skill:test",
      name: "synapse-skill",
      sourceFingerprint: "sha256:test",
    }

    await harness.invoke("synapse:installers:inspect-global-skill-installations", source)

    expect(mocks.inspectGlobalSkillInstallations).toHaveBeenCalledWith(source)
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
    const source = {
      kind: "rule" as const,
      origin: "inline" as const,
      sourceIdentity: "inline-rule:abc",
      inlineSourceId: "source-1",
      name: "team.rule",
      body: "# Rule",
    }

    await harness.invoke("synapse:installers:install-source-to-editor", {
      editorId: "codex",
      scope: "global",
      source,
      skillEnvValues: { EMPTY_ALLOWED: "" },
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        editorId: "codex",
        skillEnvValues: { EMPTY_ALLOWED: "" },
        source: expect.objectContaining({ sourceIdentity: "inline-rule:abc" }),
      }),
      expect.objectContaining({
        actor: { kind: "user" },
      }),
    )
    expect(mocks.releaseSource).toHaveBeenCalledWith(source)
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
      skillEnvValues: { GITEE_TOKEN: "saved-token" },
    }) as SynapseInstallSourceToEditorTargetsResult

    expect(result.results).toHaveLength(1)
    expect(mocks.installSourceToEditorTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "install",
        skillEnvValues: { GITEE_TOKEN: "saved-token" },
        targets: [{ editorId: "codex", scope: "global" }],
      }),
      expect.objectContaining({
        actor: { kind: "user" },
      }),
    )
    expect(mocks.releaseSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceIdentity: "synapse-skill",
    }))
  })

  it("keeps prepared sources when a batch target fails", async () => {
    mocks.installSourceToEditorTargets.mockResolvedValueOnce({
      results: [{
        target: { editorId: "codex", scope: "global" },
        status: "failed",
        error: "install failed",
      }],
    })
    const harness = createHarness()

    await harness.invoke("synapse:installers:install-source-to-editor-targets", {
      mode: "install",
      source: {
        kind: "skill",
        origin: "local-directory",
        sourceIdentity: "local-skill:abc",
        localSourceId: "source-2",
        name: "team-skill",
      },
      targets: [{ editorId: "codex", scope: "global" }],
    })

    expect(mocks.releaseSource).not.toHaveBeenCalled()
  })

  it("resolves saved secret references in main through permission and audit", async () => {
    const harness = createHarness()

    await harness.invoke("synapse:installers:install-source-to-editor", {
      editorId: "codex",
      scope: "global",
      source: {
        kind: "skill",
        origin: "repository",
        sourceIdentity: "skill-1",
        repositoryContentId: "skill-1",
        name: "team-skill",
      },
      skillEnvSecretNames: { GITEE_TOKEN: "GITEE_TOKEN" },
      skillEnvValues: { REGION: "cn" },
      variableSecretNames: { INLINE_TOKEN: "INLINE_TOKEN" },
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        skillEnvValues: { GITEE_TOKEN: "gitee_token-value", REGION: "cn" },
        variableSubstitutions: { INLINE_TOKEN: "inline_token-value" },
      }),
      expect.objectContaining({ actor: { kind: "user" } }),
    )
    expect(mocks.installSourceToEditor.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
      skillEnvSecretNames: expect.anything(),
      variableSecretNames: expect.anything(),
    }))
    expect(mocks.secretGet).toHaveBeenCalledTimes(2)
    expect(mocks.permissionCheck).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      actor: expect.objectContaining({ kind: "user", id: "installer" }),
    }))
    expect(mocks.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      outcome: "allowed",
    }))
    expect(JSON.stringify(mocks.permissionCheck.mock.calls)).not.toContain("gitee_token-value")
    expect(JSON.stringify(mocks.auditRecord.mock.calls)).not.toContain("gitee_token-value")
  })

  it("blocks install when saved secret access is denied", async () => {
    mocks.permissionCheck.mockResolvedValueOnce({ allowed: false, reason: "denied" })
    const harness = createHarness()

    await expect(harness.invoke("synapse:installers:install-source-to-editor", {
      editorId: "codex",
      scope: "global",
      source: {
        kind: "rule",
        origin: "inline",
        sourceIdentity: "inline-rule:abc",
        inlineSourceId: "source-1",
        name: "team.rule",
        body: "TOKEN=${{ TOKEN }}",
      },
      variableSecretNames: { TOKEN: "TOKEN" },
    })).rejects.toThrow("denied")

    expect(mocks.secretGet).not.toHaveBeenCalled()
    expect(mocks.installSourceToEditor).not.toHaveBeenCalled()
    expect(mocks.releaseSource).not.toHaveBeenCalled()
    expect(mocks.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      outcome: "denied",
    }))
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(installersIpcModule, {
    moduleId: "installers",
    resolve: <T,>(_serviceId: string): T => {
      if (_serviceId === "core.audit-sink") return { record: mocks.auditRecord } as T
      if (_serviceId === "core.permission-guard") return { check: mocks.permissionCheck } as T
      if (_serviceId === "core.secrets") return { get: mocks.secretGet } as T
      if (_serviceId === "core.event-bus") return { emit: vi.fn() } as T
      throw new Error(`Unexpected service: ${_serviceId}`)
    },
  })
  return harness
}
