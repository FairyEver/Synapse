import type { SynapseAgentSessionSummary } from "@/types/agent"

// 项目默认展示最近五条对话，当前对话位于历史中时额外保留一条。
const RECENT_PROJECT_SESSION_LIMIT = 5

function getProjectSessionDisclosure(
  sessions: readonly SynapseAgentSessionSummary[],
  selectedConversationId?: string,
) {
  const orderedSessions = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const recentSessions = orderedSessions.slice(0, RECENT_PROJECT_SESSION_LIMIT)
  const selectedSession = orderedSessions.find((session) => session.id === selectedConversationId)
  if (selectedSession && !recentSessions.includes(selectedSession)) {
    recentSessions.push(selectedSession)
  }

  const visibleIds = new Set(recentSessions.map((session) => session.id))
  const hiddenSessions = orderedSessions.filter((session) => !visibleIds.has(session.id))
  return { orderedSessions, recentSessions, hiddenSessions }
}

export { getProjectSessionDisclosure }
