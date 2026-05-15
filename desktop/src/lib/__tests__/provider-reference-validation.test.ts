import { describe, expect, it } from "vitest"

import { validateProviderReference } from "../provider-reference-validation"
import type { SynapseAgentProvider } from "@/types/bridge"

const activeProvider = {
  id: "active",
  name: "Active Provider",
  category: "custom",
  apiKeyField: "ANTHROPIC_API_KEY",
  active: true,
  model: "claude-sonnet-4",
  sonnetModel: "claude-sonnet-4",
  haikuModel: "",
  opusModel: "claude-opus-4",
  env: {},
  createdAt: "",
  updatedAt: "",
} satisfies SynapseAgentProvider

const archivedProvider = {
  ...activeProvider,
  id: "archived",
  name: "Archived",
  active: false,
  archived: true,
} satisfies SynapseAgentProvider

describe("validateProviderReference", () => {
  it("returns valid for existing active provider with available tier", () => {
    const result = validateProviderReference("active", "sonnet", [activeProvider], [activeProvider])
    expect(result).toEqual({ valid: true })
  })

  it("returns provider_not_found when provider is missing from all providers", () => {
    const result = validateProviderReference("gone", "sonnet", [activeProvider], [activeProvider])
    expect(result).toEqual({ valid: false, reason: "provider_not_found" })
  })

  it("returns provider_archived when provider is only in allProviders", () => {
    const result = validateProviderReference("archived", "sonnet", [activeProvider], [activeProvider, archivedProvider])
    expect(result).toEqual({ valid: false, reason: "provider_archived" })
  })

  it("returns tier_unavailable when tier model is empty", () => {
    const result = validateProviderReference("active", "haiku", [activeProvider], [activeProvider])
    expect(result).toEqual({ degraded: true, reason: "tier_unavailable", fallbackModel: "claude-sonnet-4" })
  })
})
