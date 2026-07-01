import { createHash } from "node:crypto"

import type { AgentPersona } from "../../../app-capabilities/agent-personas/shared/schema"
import type { ConversationEntryV1, ConversationMainThreadPersonaSnapshotV1 } from "../../runtime/data-repo"
import type { AgentSdkAgentDefinitions } from "./project-contributions"

const SDK_AGENT_PREFIX = "synapse-persona__"

export type AgentPersonaRuntimeResolverDeps = {
  readonly listPersonas: () => Promise<readonly AgentPersona[]>
}

export type ResolvedPersonaSdkConfig = {
  readonly activePersonaId: string | null
  readonly activeAgentName?: string
  readonly snapshot?: ConversationMainThreadPersonaSnapshotV1
  readonly agents: AgentSdkAgentDefinitions
  readonly definitionsHash: string
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
      return { activePersonaId: null, agents, definitionsHash }
    }
    const persona = personas.find((item) => item.id === activePersonaId)
    if (!persona) {
      return { activePersonaId: null, agents, definitionsHash }
    }
    const activeAgentName = sdkAgentNameForPersona(persona.id)
    const snapshot = snapshotForPersona(persona, agents[activeAgentName])
    return {
      activePersonaId,
      activeAgentName,
      snapshot,
      agents,
      definitionsHash,
    }
  }

  return { resolve }
}

function toSdkAgents(personas: readonly AgentPersona[]): AgentSdkAgentDefinitions {
  return Object.fromEntries(personas.map((persona) => [
    sdkAgentNameForPersona(persona.id),
    {
      description: persona.description,
      prompt: persona.systemPrompt,
      disallowedTools: ["Agent"],
    },
  ]))
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
