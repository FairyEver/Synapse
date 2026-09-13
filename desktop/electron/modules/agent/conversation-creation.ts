import type { AgentConversationCreateInput } from "../../../app-capabilities/agent/shared/schema"
import { configStore } from "../../services/config-store"
import { PROVIDER_SERVICE_ID, type ProviderService } from "../../services/provider"
import { pickInitialProviderModelSelection } from "../../../src/lib/provider-model-selection"
import { isDefaultAgentWorkspaceProjectId } from "../../../src/lib/default-agent-workspace"
import { formatCreateSessionName } from "../../../src/modules/agent/create-session-name"
import { AgentConversationCapabilityError } from "../../../app-capabilities/agent/shared/errors"
import {
  assertKnowledgeBaseStorageMigrationInactive,
  DEFAULT_LOCAL_SESSION_KEY,
  LOCAL_RENDERER_PLATFORM,
  resolveProjectAgent,
} from "./ipc-shared"

/** MCP reuses UI model selection and local runtime creation. Explicit choices never fall back. */
export async function createLocalAgentConversation(
  resolve: <T>(serviceId: string) => T,
  input: Pick<AgentConversationCreateInput, "name" | "providerId" | "modelTier"> & { readonly projectId: string },
) {
  const config = await configStore.load()
  const project = config.global.projects.find((item) => item.id === input.projectId)
  if (!project && !isDefaultAgentWorkspaceProjectId(input.projectId)) {
    throw new AgentConversationCapabilityError("group_not_found")
  }
  assertKnowledgeBaseStorageMigrationInactive(resolve, project)
  const providers = await resolve<ProviderService>(PROVIDER_SERVICE_ID).listAllProviders()
  if ((input.providerId === undefined) !== (input.modelTier === undefined)) {
    throw new AgentConversationCapabilityError("invalid_input")
  }
  const explicitModel = input.providerId !== undefined && input.modelTier !== undefined
    ? { providerId: input.providerId, modelTier: input.modelTier }
    : undefined
  const selection = pickInitialProviderModelSelection(
    providers, explicitModel ?? config.agent.defaultProviderModel, !explicitModel,
  )
  if (!selection) throw new AgentConversationCapabilityError("model_unavailable")

  let agent
  try {
    agent = (await resolveProjectAgent(resolve, input.projectId)).agent
  } catch {
    throw new AgentConversationCapabilityError("project_unavailable")
  }
  return agent.createSession({
    sessionKey: DEFAULT_LOCAL_SESSION_KEY,
    platform: LOCAL_RENDERER_PLATFORM,
    name: input.name ?? formatCreateSessionName(new Date()),
    agentType: "claude-code",
    providerId: selection.providerId,
    modelTier: selection.modelTier,
    mode: config.agent.defaultPermissionMode ?? "default",
    personaId: null,
  })
}
