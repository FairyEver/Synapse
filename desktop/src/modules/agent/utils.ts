import type {
  SynapseAgentPendingPermission,
  SynapseAgentProviderSummary,
  SynapseAgentSessionSummary,
} from "@/types/agent"
import {
  formatAgentInputText,
  formatAgentTranscript,
  formatEntryTime,
  sanitizeAgentRawInput,
} from "@/lib/agent-transcript"
import { errorLogMeta } from "@/lib/error-sanitize"
import { formatProviderModelLabel, resolveModelName } from "@/lib/provider-model"
import type { ModelTier } from "@/types/provider-model"

const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
const THINKING_DOT = "·"

function sessionLabel(session: SynapseAgentSessionSummary): string {
  return session.name || session.sourceLabel || session.sessionKey || DEFAULT_LOCAL_SESSION_KEY
}

function formatAgentHeaderModelLabel(input: {
  readonly currentConversationModel?: string
  readonly provider?: SynapseAgentProviderSummary
  readonly modelTier?: string
}): string | undefined {
  const model = input.currentConversationModel?.trim()
  const providerName = input.provider ? providerDisplayName(input.provider) : undefined
  if (model) return providerName ? `${providerName} ${model}` : model
  if (!input.provider || !providerName) return undefined

  const explicitTier = modelTierFromString(input.modelTier)
  const tier = explicitTier ?? "default"
  const modelName = resolveModelName(input.provider, tier)
  if (modelName || explicitTier) {
    return formatProviderModelLabel(providerName, modelName, tier, input.provider)
  }
  return providerName
}

function providerDisplayName(provider: SynapseAgentProviderSummary): string {
  return provider.display?.trim() || provider.id
}

function modelTierFromString(value: string | undefined): ModelTier | undefined {
  return value === "default" || value === "haiku" || value === "sonnet" || value === "opus"
    ? value
    : undefined
}

function defaultSessionKey(sessions: readonly SynapseAgentSessionSummary[]): string {
  return sessions.find((session) => session.active)?.sessionKey
    ?? sessions[0]?.sessionKey
    ?? DEFAULT_LOCAL_SESSION_KEY
}

function defaultSessionId(sessions: readonly SynapseAgentSessionSummary[]): string | undefined {
  return sessions.find((session) => session.active)?.id
    ?? sessions[0]?.id
}

function pendingPermissionKey(
  permission: Pick<SynapseAgentPendingPermission, "projectId" | "requestId">,
): string {
  return `${permission.projectId}\0${permission.requestId}`
}

function thinkingIndicatorText(frame: number): string {
  const dotCount = ((frame % 4) + 4) % 4
  return `thinking${THINKING_DOT.repeat(dotCount)}`
}

export {
  DEFAULT_LOCAL_SESSION_KEY,
  defaultSessionId,
  defaultSessionKey,
  errorLogMeta,
  formatAgentHeaderModelLabel,
  formatAgentInputText,
  formatAgentTranscript,
  formatEntryTime,
  pendingPermissionKey,
  sanitizeAgentRawInput,
  sessionLabel,
  thinkingIndicatorText,
}
