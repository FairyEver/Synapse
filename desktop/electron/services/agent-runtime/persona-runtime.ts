import { createHash } from "node:crypto"

import type {
  AgentPersona,
  AgentPersonaProviderModel,
  AgentPersonaToolPolicy,
} from "../../../app-capabilities/agent-personas/shared/schema"
import type { ConversationEntryV1, ConversationMainThreadPersonaSnapshotV1 } from "../../runtime/data-repo"
import type { AgentSdkAgentDefinitions, AgentSdkSystemPrompt } from "./project-contributions"

const SDK_AGENT_PREFIX = "synapse-persona__"

export type AgentPersonaRuntimeResolverDeps = {
  readonly listPersonas: () => Promise<readonly AgentPersona[]>
}

export type ResolvedPersonaSdkConfig = {
  readonly activePersonaId: string | null
  readonly providerModel: AgentPersonaProviderModel | null
  readonly activeAgentName?: string
  readonly systemPrompt?: AgentSdkSystemPrompt
  readonly toolPolicy?: AgentPersonaRuntimeToolPolicy
  readonly snapshot?: ConversationMainThreadPersonaSnapshotV1
  readonly agents: AgentSdkAgentDefinitions
  readonly definitionsHash: string
}

export type AgentPersonaRuntimeToolPolicy = {
  readonly mode: "all" | "allowlist" | "disabled"
  readonly allowedTools: readonly string[]
}

export function sdkAgentNameForPersona(personaId: string): string {
  return `${SDK_AGENT_PREFIX}${personaId.trim()}`
}

export function createAgentPersonaRuntimeResolver(deps: AgentPersonaRuntimeResolverDeps) {
  async function resolve(
    conversation: Pick<ConversationEntryV1, "agentConfig">,
  ): Promise<ResolvedPersonaSdkConfig> {
    const personas = await deps.listPersonas()
    const agents = toSdkAgents(personas)
    const definitionsHash = hashJson(agents)
    const activePersonaId = conversation.agentConfig?.activeMainThreadPersonaId ?? null
    if (!activePersonaId) {
      return { activePersonaId: null, providerModel: null, agents, definitionsHash }
    }
    const persona = personas.find((item) => item.id === activePersonaId)
    if (!persona) {
      return { activePersonaId: null, providerModel: null, agents, definitionsHash }
    }
    const activeAgentName = sdkAgentNameForPersona(persona.id)
    const snapshot = snapshotForPersona(persona, agents[activeAgentName])
    const toolPolicy = normalizeToolPolicy(persona.toolPolicy)
    return {
      activePersonaId,
      providerModel: persona.providerModel,
      activeAgentName,
      systemPrompt: systemPromptForPersona(persona),
      toolPolicy,
      snapshot,
      agents,
      definitionsHash,
    }
  }

  return { resolve }
}

function toSdkAgents(personas: readonly AgentPersona[]): AgentSdkAgentDefinitions {
  return Object.fromEntries(personas.map((persona) => {
    const toolPolicy = normalizeToolPolicy(persona.toolPolicy)
    return [
      sdkAgentNameForPersona(persona.id),
      {
        description: persona.description,
        prompt: persona.systemPrompt,
        ...sdkToolOptionsForPolicy(toolPolicy),
      },
    ]
  }))
}

function systemPromptForPersona(persona: AgentPersona): AgentSdkSystemPrompt {
  return {
    type: "preset",
    preset: "claude_code",
    append: persona.systemPrompt,
  }
}

function sdkToolOptionsForPolicy(
  policy: AgentPersonaRuntimeToolPolicy,
): Pick<AgentSdkAgentDefinitions[string], "tools" | "disallowedTools"> {
  if (policy.mode === "disabled") {
    return { tools: [], disallowedTools: ["*"] }
  }
  if (policy.mode === "allowlist") {
    return { tools: [...policy.allowedTools], disallowedTools: disallowedToolsForAllowlist(policy.allowedTools) }
  }
  return { disallowedTools: ["Agent"] }
}

function disallowedToolsForAllowlist(allowedTools: readonly string[]): string[] {
  return allowedTools.includes("Agent") ? [] : ["Agent"]
}

function normalizeToolPolicy(value: AgentPersonaToolPolicy | null | undefined): AgentPersonaRuntimeToolPolicy {
  if (value?.mode !== "allowlist") {
    return { mode: value?.mode ?? "all", allowedTools: [] }
  }
  return {
    mode: "allowlist",
    allowedTools: uniqueNonBlankStrings(value.allowedTools ?? []),
  }
}

function uniqueNonBlankStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function snapshotForPersona(
  persona: AgentPersona,
  definition: AgentSdkAgentDefinitions[string] | undefined,
): ConversationMainThreadPersonaSnapshotV1 {
  return {
    id: persona.id,
    name: persona.name,
    source: persona.source,
    definitionHash: hashJson(definition ?? {}),
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex")
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortJson(item)]))
}
