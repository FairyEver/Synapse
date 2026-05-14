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
})
