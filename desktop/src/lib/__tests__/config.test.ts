import { describe, expect, it } from "vitest"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
  hasRecoverableSynapseConfigFormatError,
  sanitizeSynapseConfig,
} from "../config"

describe("Synapse config Agent defaults", () => {
  it("defaults new Agent conversations to default permission mode", () => {
    expect(createDefaultConfig().agent.defaultPermissionMode).toBe("default")
  })

  it("normalizes missing Agent config to safe defaults", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: { themeMode: "light", projects: [] },
    })

    expect(config.agent.defaultPermissionMode).toBe("default")
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

  it("defaults defaultProviderModel to null", () => {
    expect(createDefaultConfig().agent.defaultProviderModel).toBeNull()
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

  it("defaults quick inputs to an empty list", () => {
    expect(createDefaultConfig().global.quickInputs).toEqual([])
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

    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "第一行\n第二行" },
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

    expect(config.global.quickInputs).toEqual([
      { id: "quick-1", content: "有效内容" },
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
        quickInputs: [{ id: "quick-1", content: "复用这段话" }],
      },
    })

    expect(next.global.projects).toEqual(current.global.projects)
    expect(next.global.quickInputs).toEqual([
      { id: "quick-1", content: "复用这段话" },
    ])
  })
})
