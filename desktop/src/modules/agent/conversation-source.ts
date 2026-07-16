import type { SynapseAgentSessionSummary } from "@/types/agent"
import type { SynapseAgentConversationSourceFilter } from "@/types/agent-navigation"

type ConversationSourceFilter = SynapseAgentConversationSourceFilter

const CONVERSATION_SOURCE_OPTIONS: Array<{ value: ConversationSourceFilter; label: string }> = [
  { value: "user", label: "用户对话" },
  { value: "automation", label: "自动化" },
  { value: "scheduled", label: "历史计划" },
  { value: "workflow", label: "工作流" },
  { value: "webhook", label: "Webhook" },
  { value: "relay", label: "Relay" },
  { value: "bridge", label: "外部桥接" },
  { value: "all", label: "全部" },
]

function conversationSourceForPlatform(
  platform: string | undefined,
): Exclude<ConversationSourceFilter, "all"> {
  const normalized = platform?.trim()
  if (!normalized || normalized === "local" || normalized === "local-renderer") return "user"
  if (normalized === "automation") return "automation"
  if (normalized === "scheduled") return "scheduled"
  if (normalized === "workflow") return "workflow"
  if (normalized === "webhook") return "webhook"
  if (normalized === "relay") return "relay"
  return "bridge"
}

function conversationSourceForSession(
  session: Pick<SynapseAgentSessionSummary, "platform">,
): Exclude<ConversationSourceFilter, "all"> {
  return conversationSourceForPlatform(session.platform)
}

function filterSessionsBySource<T extends Pick<SynapseAgentSessionSummary, "platform">>(
  sessions: readonly T[],
  source: ConversationSourceFilter,
): T[] {
  if (source === "all") return [...sessions]
  return sessions.filter((session) => conversationSourceForSession(session) === source)
}

export {
  CONVERSATION_SOURCE_OPTIONS,
  conversationSourceForPlatform,
  conversationSourceForSession,
  filterSessionsBySource,
  type ConversationSourceFilter,
}
