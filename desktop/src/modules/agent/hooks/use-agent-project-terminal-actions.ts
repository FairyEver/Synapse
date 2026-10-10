import { useCallback } from "react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { isMainAppWindow, requestOpenTerminalSession } from "@/app-shell/terminal-navigation"
import { launchClaudeCodeTerminal } from "@/lib/claude-code-terminal-launch"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("agent.terminal-actions")

type AgentProjectTerminalTarget = {
  readonly id: string
  readonly path: string
}

type AgentClaudeCodeTerminalTarget = {
  readonly id: string
  readonly selection: ProviderModelSelection
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `agent-terminal-${Date.now().toString(36)}`
}

function useAgentProjectTerminalActions() {
  const openProjectInTerminal = useCallback(async (project: AgentProjectTerminalTarget) => {
    const bridge = requireSynapseBridge()
    let sessionId: string
    try {
      const session = await bridge.terminal.session.create({
        projectId: project.id,
        cwd: project.path,
      })
      sessionId = session.id
    } catch (rawError) {
      logger.warn("Agent project terminal creation failed.", {
        boundary: "renderer.agent.project-open-terminal.create",
        projectId: project.id,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      toast.error("无法在终端中打开项目。")
      return
    }

    try {
      await bridge.apps.openSystemApp("terminal", {
        terminalOpenRequest: {
          requestId: createRequestId(),
          sessionId,
        },
      })
    } catch (rawError) {
      logger.warn("Agent project terminal window open failed.", {
        boundary: "renderer.agent.project-open-terminal.window",
        projectId: project.id,
        sessionId,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      toast.error("终端已创建，但无法打开终端应用。")
    }
  }, [])

  const openClaudeCodeTerminalSession = useCallback(async (projectId: string, sessionId: string) => {
    const bridge = requireSynapseBridge()
    const openRequest = { requestId: createRequestId(), sessionId: sessionId }
    try {
      if (isMainAppWindow()) {
        requestOpenTerminalSession(openRequest)
        return
      }
      await bridge.apps.openSystemApp("terminal", {
        terminalOpenRequest: openRequest,
      })
    } catch (rawError) {
      logger.warn("Claude Code terminal window open failed.", {
        boundary: "renderer.agent.claude-code-terminal.window",
        projectId: projectId,
        sessionId: sessionId,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      toast.error("Claude Code 已启动，但无法打开终端应用。")
    }
  }, [])

  const startClaudeCodeTerminal = useCallback(async (target: AgentClaudeCodeTerminalTarget): Promise<boolean> => {
    const launched = await launchClaudeCodeTerminal({
      projectId: target.id,
      selection: target.selection,
    })
    if (!launched.ok) {
      toast.error(launched.message)
      return false
    }

    await openClaudeCodeTerminalSession(target.id, launched.sessionId)
    return true
  }, [openClaudeCodeTerminalSession])

  const resumeClaudeCodeTerminal = useCallback(async (target: { projectId: string; conversationId: string }): Promise<boolean> => {
    let sessionId: string
    try {
      const result = await requireSynapseBridge().agent.resumeClaudeCodeTerminal(target)
      sessionId = result.sessionId
    } catch (rawError) {
      logger.warn("Claude Code continuation failed.", {
        boundary: "renderer.agent.claude-code-terminal.resume", ...target,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      const detail = rawError instanceof Error
        ? rawError.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : ""
      toast.error(detail || "无法在 Claude Code 中继续，请重试。")
      return false
    }
    await openClaudeCodeTerminalSession(target.projectId, sessionId)
    return true
  }, [openClaudeCodeTerminalSession])

  return { openProjectInTerminal, startClaudeCodeTerminal, resumeClaudeCodeTerminal }
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { useAgentProjectTerminalActions }
