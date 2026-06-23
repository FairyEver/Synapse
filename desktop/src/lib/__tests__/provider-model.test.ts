import { describe, expect, it } from "vitest"
import {
  LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL,
  formatProviderModelLabel,
  isProviderModelTierSelectable,
  resolveModelDisplayName,
  resolveModelName,
} from "../provider-model"

describe("provider model helpers", () => {
  it("allows local Claude Code default tier without inventing a model name", () => {
    const provider = {
      id: "local-claude-code",
      source: "local" as const,
    }

    expect(resolveModelName(provider, "default")).toBeUndefined()
    expect(isProviderModelTierSelectable(provider, "default")).toBe(true)
    expect(resolveModelDisplayName(provider, "default")).toBe(LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL)
    expect(formatProviderModelLabel("ClaudeCode/Synapse", undefined, "default", provider))
      .toBe(`ClaudeCode/Synapse ${LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL}`)
  })

  it("does not allow empty tiers for non-local providers", () => {
    const provider = {
      id: "custom-provider",
      source: "user" as const,
    }

    expect(resolveModelName(provider, "default")).toBeUndefined()
    expect(isProviderModelTierSelectable(provider, "default")).toBe(false)
    expect(resolveModelDisplayName(provider, "default")).toBeUndefined()
  })

  it("uses explicit model ids before local default display labels", () => {
    const provider = {
      id: "local-claude-code",
      source: "local" as const,
      sonnetModel: "claude-sonnet-from-settings",
    }

    expect(resolveModelName(provider, "sonnet")).toBe("claude-sonnet-from-settings")
    expect(isProviderModelTierSelectable(provider, "sonnet")).toBe(true)
    expect(resolveModelDisplayName(provider, "sonnet")).toBe("claude-sonnet-from-settings")
  })
})
