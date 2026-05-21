import { describe, expect, it } from "vitest"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
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
  it("preserves valid knowledge base capability config", () => {
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

    expect(config.global.projects[0]?.capabilities?.knowledgeBase).toEqual({
      enabled: true,
      schemaVersion: 1,
      templateVersion: "2026-05-21",
    })
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
              templateVersion: "2026-05-21",
            },
          },
        }],
      },
    })

    expect(next.global.projects).toHaveLength(1)
    expect(next.global.projects[0]?.name).toBe("KB")
    expect(next.global.projects[0]?.capabilities?.knowledgeBase?.enabled).toBe(true)
  })
})
