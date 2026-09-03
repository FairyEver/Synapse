import { describe, expect, it } from "vitest"
import { DEFAULT_QUICK_INPUTS } from "../../constants/defaults"
import { DEFAULT_DOCK_APP_IDS } from "../../modules/apps/dock"
import { SYNAPSE_APP_VERSION } from "../app-version"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
  hasRecoverableSynapseConfigFormatError,
  sanitizeSynapseConfig,
} from "../config"

describe("Synapse config Agent defaults", () => {
  it("defaults new Agent conversations to default permission mode", () => {
    expect(createDefaultConfig().agent.defaultPermissionMode).toBe("default")
    expect(createDefaultConfig().agent.experimentalSynapseToolRouterEnabled).toBe(false)
    expect(createDefaultConfig().agent.recentSlashSkills).toEqual([])
    expect(createDefaultConfig().agent.allowedWriteDirectories).toEqual([])
  })

  it("normalizes missing Agent config to safe defaults", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
    })

    expect(config.agent.defaultPermissionMode).toBe("default")
    expect(config.agent.experimentalSynapseToolRouterEnabled).toBe(false)
    expect(config.agent.allowedWriteDirectories).toEqual([])
  })

  it("normalizes configured Agent write directories", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { allowedWriteDirectories: [" /tmp ", "/tmp", 42, ""] },
    })

    expect(config.agent.allowedWriteDirectories).toEqual(["/tmp"])
  })

  it("only enables the experimental Synapse tool router for an explicit boolean true", () => {
    const enabled = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { experimentalSynapseToolRouterEnabled: true },
    })
    const invalid = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { experimentalSynapseToolRouterEnabled: "true" },
    })

    expect(enabled.agent.experimentalSynapseToolRouterEnabled).toBe(true)
    expect(invalid.agent.experimentalSynapseToolRouterEnabled).toBe(false)
  })

  it("normalizes Agent defaultPermissionMode only when it is supported", () => {
    const plan = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "plan" },
    })
    const invalid = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "free-for-all" },
    })

    expect(plan.agent.defaultPermissionMode).toBe("plan")
    expect(invalid.agent.defaultPermissionMode).toBe("default")
  })

  it("migrates the legacy Agent bypass default boolean to a permission mode", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultBypassPermissions: true },
    })

    expect(config.agent.defaultPermissionMode).toBe("bypassPermissions")
  })

  it("applies Agent config patches without changing existing global settings", () => {
    const current = createDefaultConfig()
    const next = applySynapseConfigPatch(current, {
      agent: { defaultPermissionMode: "bypassPermissions" },
    })

    expect(next.agent.defaultPermissionMode).toBe("bypassPermissions")
    expect(next.global.themeMode).toBe(current.global.themeMode)
  })

  it("normalizes recent Slash Skills as a global three-item MRU list", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: {
        recentSlashSkills: [" /Review-Code ", "OPENAI-DOCS", "review-code", "fourth"],
      },
    })

    expect(config.agent.recentSlashSkills).toEqual(["review-code", "openai-docs", "fourth"])
  })

  it("defaults defaultProviderModel to null", () => {
    expect(createDefaultConfig().agent.defaultProviderModel).toBeNull()
  })

  it("does not include conversation rollover prompt thresholds in defaults", () => {
    expect(createDefaultConfig().agent).not.toHaveProperty("conversationRolloverPrompt")
  })

  it("ignores legacy conversation rollover prompt thresholds during normalization", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: {
        defaultPermissionMode: "plan",
        conversationRolloverPrompt: {
          costThresholdCny: 25,
          tokenThreshold: 7_500_000,
        },
      },
    })

    expect(config.agent.defaultPermissionMode).toBe("plan")
    expect(config.agent).not.toHaveProperty("conversationRolloverPrompt")
  })

  it("ignores legacy conversation rollover prompt patches without changing permission mode or default model", () => {
    const current = applySynapseConfigPatch(createDefaultConfig(), {
      agent: {
        defaultPermissionMode: "plan",
        defaultProviderModel: { providerId: "p1", modelTier: "sonnet" },
      },
    })
    const next = applySynapseConfigPatch(current, {
      agent: {
        conversationRolloverPrompt: {
          costThresholdCny: 12.5,
          tokenThreshold: 8_000_000,
        },
      },
    } as never)

    expect(next.agent.defaultPermissionMode).toBe("plan")
    expect(next.agent.defaultProviderModel).toEqual({ providerId: "p1", modelTier: "sonnet" })
    expect(next.agent).not.toHaveProperty("conversationRolloverPrompt")
  })

  it("normalizes valid defaultProviderModel", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "abc", modelTier: "sonnet" } },
    })
    expect(config.agent.defaultProviderModel).toEqual({ providerId: "abc", modelTier: "sonnet" })
  })

  it("normalizes invalid defaultProviderModel to null", () => {
    const empty = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "", modelTier: "sonnet" } },
    })
    const badTier = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "abc", modelTier: "turbo" } },
    })
    const notObj = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
      agent: { defaultPermissionMode: "default", defaultProviderModel: "hello" },
    })
    expect(empty.agent.defaultProviderModel).toBeNull()
    expect(badTier.agent.defaultProviderModel).toBeNull()
    expect(notObj.agent.defaultProviderModel).toBeNull()
  })

  it("applies defaultProviderModel patch", () => {
    const current = createDefaultConfig()
    const next = applySynapseConfigPatch(current, {
      agent: { defaultProviderModel: { providerId: "p1", modelTier: "opus" } },
    })
    expect(next.agent.defaultProviderModel).toEqual({ providerId: "p1", modelTier: "opus" })
    expect(next.agent.defaultPermissionMode).toBe("default")
  })

  it("clears defaultProviderModel with null patch", () => {
    const current = applySynapseConfigPatch(createDefaultConfig(), {
      agent: { defaultProviderModel: { providerId: "p1", modelTier: "opus" } },
    })
    const cleared = applySynapseConfigPatch(current, {
      agent: { defaultProviderModel: null },
    })
    expect(cleared.agent.defaultProviderModel).toBeNull()
  })
})

describe("Synapse Knowledge Base storage config", () => {
  it("defaults knowledge base storage to userData mode", () => {
    expect(createDefaultConfig().global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("keeps a trimmed custom knowledge base storage root", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        knowledgeBaseStorage: {
          mode: "custom",
          rootPath: "  /Volumes/Data/SynapseData  ",
        },
      },
    })

    expect(config.global.knowledgeBaseStorage).toEqual({
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
    })
  })

  it("falls back to default mode when custom root is empty", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        knowledgeBaseStorage: {
          mode: "custom",
          rootPath: "   ",
        },
      },
    })

    expect(config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })
})

describe("Synapse project capabilities", () => {
  it("drops legacy non-managed knowledge base capability config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "project-1",
          name: "KB",
          path: "/Users/example/kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]?.capabilities).toBeUndefined()
  })

  it("drops malformed knowledge base capability config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "project-1",
          name: "Project",
          path: "/Users/example/project",
          capabilities: {
            knowledgeBase: {
              enabled: false,
              schemaVersion: 2,
              templateVersion: "",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]?.capabilities).toBeUndefined()
  })

  it("preserves managed knowledge base capability metadata", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "kb-1",
          name: "Knowledge",
          path: "synapse-kb://kb-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: "kb-1",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]).toEqual(expect.objectContaining({
      id: "kb-1",
      name: "Knowledge",
      path: "synapse-kb://kb-1",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-24",
          managed: true,
          runtimeId: "kb-1",
        },
      },
    }))
  })

  it("drops invalid managed knowledge base runtime ids", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "kb-1",
          name: "Knowledge",
          path: "synapse-kb://kb-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: "",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]?.capabilities).toBeUndefined()
  })

  it("applies project capability patches without dropping existing project fields", () => {
    const current = createDefaultConfig()
    const next = applySynapseConfigPatch(current, {
      global: {
        projects: [{
          id: "project-1",
          name: "KB",
          path: "/Users/example/kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: "project-1",
            },
          },
        }],
      },
    })

    expect(next.global.projects).toHaveLength(1)
    expect(next.global.projects[0]?.name).toBe("KB")
    expect(next.global.projects[0]?.capabilities?.knowledgeBase?.managed).toBe(true)
  })
})

describe("Synapse quick inputs config", () => {
  it("treats non-array quick input containers as recoverable format errors", () => {
    expect(hasRecoverableSynapseConfigFormatError({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: "invalid",
      },
    })).toBe(true)
  })

  it("allows malformed quick input entries to be sanitized when the container is an array", () => {
    expect(hasRecoverableSynapseConfigFormatError({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "有效内容" },
          { id: "quick-2", content: "   " },
          { id: "", content: "缺少 ID" },
          "invalid",
        ],
      },
    })).toBe(false)
  })

  it("seeds built-in quick inputs in a default config", () => {
    const config = createDefaultConfig()

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual(DEFAULT_QUICK_INPUTS)
    expect(config.global.quickInputs).toHaveLength(6)
    expect(config.global.quickInputs.every((item) => item.directSend)).toBe(true)
  })

  it("seeds built-in quick inputs for an empty legacy config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual(DEFAULT_QUICK_INPUTS)
  })

  it("does not add built-in quick inputs when user snippets already exist", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "用户自己的片段", directSend: true },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "用户自己的片段", directSend: true },
    ])
  })

  it("does not re-add defaults after the current version already ran the seed check", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [],
        defaultQuickInputsSeededVersion: SYNAPSE_APP_VERSION,
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([])
  })

  it("records the current seed version without replacing existing snippets from older versions", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "保留我", directSend: false },
        ],
        defaultQuickInputsSeededVersion: "0.2.238",
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "保留我", directSend: false },
    ])
  })

  it("preserves valid multi-line quick input content", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "第一行\n第二行" },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "第一行\n第二行", directSend: false },
    ])
  })

  it("preserves direct send quick input settings", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "继续", directSend: true },
          { id: "quick-2", content: "插入这段", directSend: false },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "继续", directSend: true },
      { id: "quick-2", content: "插入这段", directSend: false },
    ])
  })

  it("defaults missing or malformed quick input direct send settings to false", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "旧片段" },
          { id: "quick-2", content: "错误开关", directSend: "yes" },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "旧片段", directSend: false },
      { id: "quick-2", content: "错误开关", directSend: false },
    ])
  })

  it("filters malformed and blank quick inputs", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        quickInputs: [
          { id: "quick-1", content: "有效内容" },
          { id: "quick-2", content: "   " },
          { id: "", content: "缺少 ID" },
          { id: "quick-3", content: 123 },
          "invalid",
          { id: "quick-1", content: "重复 ID" },
        ],
      },
    })

    expect(config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "有效内容", directSend: false },
    ])
  })

  it("applies quick input patches without changing existing projects", () => {
    const current = applySynapseConfigPatch(createDefaultConfig(), {
      global: {
        projects: [{
          id: "project-1",
          name: "Project",
          path: "/Users/example/project",
        }],
      },
    })
    const next = applySynapseConfigPatch(current, {
      global: {
        quickInputs: [{ id: "quick-1", content: "复用这段话", directSend: true }],
      },
    })

    expect(next.global.projects).toEqual(current.global.projects)
    expect(next.global.quickInputs).toEqual([
      { id: "quick-1", content: "复用这段话", directSend: true },
    ])
  })
})

describe("Synapse user variables config", () => {
  it("defaults user variables to an empty list", () => {
    expect(createDefaultConfig().global.variables).toEqual([])
  })

  it("normalizes global variables and drops malformed entries", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        variables: [
          { name: "TOKEN", value: "secret", description: " api token " },
          { name: "bad-name", value: "bad" },
          { name: "EMPTY", value: "" },
          { name: "TOKEN", value: "duplicate" },
        ],
      },
    })

    expect(config.global.variables).toEqual([
      { name: "TOKEN", value: "secret", description: "api token" },
      { name: "EMPTY", value: "" },
    ])
  })

  it("migrates legacy repository variables into global variables without keeping repository variables", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: "repo-2",
      repositories: [
        {
          uuid: "repo-1",
          name: "First Repo",
          localPath: "/repo/first",
          contentDirs: {},
          variables: [
            { name: "TOKEN", value: "first-secret", description: "first token" },
            { name: "SHARED", value: "same" },
          ],
        },
        {
          uuid: "repo-2",
          name: "Active Repo",
          localPath: "/repo/active",
          contentDirs: {},
          variables: [
            { name: "TOKEN", value: "active-secret", description: "active token" },
            { name: "SHARED", value: "same" },
            { name: "OTHER", value: "other-secret" },
          ],
        },
      ],
      global: { themeMode: "light", projects: [] },
    })

    expect(config.repositories.every((repository) => !("variables" in repository))).toBe(true)
    expect(config.global.variables).toEqual([
      { name: "TOKEN", value: "active-secret", description: "active token" },
      { name: "SHARED", value: "same" },
      { name: "OTHER", value: "other-secret" },
      {
        name: "TOKEN__First_Repo",
        value: "first-secret",
        description: "first token；来源：First Repo",
      },
    ])
  })

  it("preserves existing global variables before adding legacy repository variables", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        localPath: "/repo",
        contentDirs: {},
        variables: [
          { name: "TOKEN", value: "repo-secret" },
          { name: "NEW_ONE", value: "new-secret" },
        ],
      }],
      global: {
        themeMode: "light",
        projects: [],
        variables: [{ name: "TOKEN", value: "global-secret", description: "global token" }],
      },
    })

    expect(config.global.variables).toEqual([
      { name: "TOKEN", value: "global-secret", description: "global token" },
      { name: "TOKEN__Repo", value: "repo-secret", description: "来源：Repo" },
      { name: "NEW_ONE", value: "new-secret" },
    ])
  })

  it("applies global variable patches without changing existing projects", () => {
    const current = applySynapseConfigPatch(createDefaultConfig(), {
      global: {
        projects: [{ id: "project-1", name: "Project", path: "/project" }],
      },
    })
    const next = applySynapseConfigPatch(current, {
      global: {
        variables: [{ name: "API_KEY", value: "secret" }],
      },
    })

    expect(next.global.projects).toEqual(current.global.projects)
    expect(next.global.variables).toEqual([{ name: "API_KEY", value: "secret" }])
  })

  it("seeds and normalizes Dock app ids in global config", () => {
    expect(createDefaultConfig().global.dockAppIds).toEqual(DEFAULT_DOCK_APP_IDS)

    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [],
        dockAppIds: ["database", "ghost", "database"],
      },
    })

    expect(config.global.dockAppIds).toEqual(["database", "launcher"])
  })
})
