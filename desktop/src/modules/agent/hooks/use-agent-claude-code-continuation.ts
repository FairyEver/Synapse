import { useCallback, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { useAgentProjectTerminalActions } from "./use-agent-project-terminal-actions"

const logger = createRendererLogger("agent.claude-code-continuation")

export function useAgentClaudeCodeContinuation(session: SynapseAgentSessionSummary, refresh: () => Promise<void>) {
  const { resumeClaudeCodeTerminal } = useAgentProjectTerminalActions()
  const key = `${session.projectId}:${session.id}`
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set())
  const [continuingKey, setContinuingKey] = useState<string | null>(null)
  const inFlight = useRef(false)
  const resume = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setContinuingKey(key)
    try {
      const resumed = await resumeClaudeCodeTerminal({ projectId: session.projectId, conversationId: session.id })
      if (resumed) setCompleted((current) => new Set([...current, key]))
      // Failure can also leave a durable lock if an SDK/CLI stop is uncertain.
      await refresh()
    } catch (error) {
      logger.warn("Agent continuation state refresh failed.", {
        projectId: session.projectId, conversationId: session.id,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    } finally {
      inFlight.current = false
      setContinuingKey(null)
    }
  }, [key, refresh, resumeClaudeCodeTerminal, session.id, session.projectId])
  return {
    readOnly: Boolean(session.claudeCodeContinuation) || completed.has(key),
    continuing: continuingKey === key,
    resume,
  }
}
