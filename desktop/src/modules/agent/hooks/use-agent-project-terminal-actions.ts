import { useCallback } from "react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { isMainAppWindow, requestOpenTerminalSession } from "@/app-shell/terminal-navigation"
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

  const startClaudeCodeTerminal = useCallback(async (target: AgentClaudeCodeTerminalTarget): Promise<boolean> => {
    const bridge = requireSynapseBridge()
    let sessionId: string
    try {
      const created = await bridge.agent.createClaudeCodeTerminal({
        projectId: target.id,
        providerId: target.selection.providerId,
        modelTier: target.selection.modelTier,
      })
      sessionId = created.sessionId
    } catch (rawError) {
      logger.warn("Claude Code terminal creation failed.", {
        boundary: "renderer.agent.claude-code-terminal.create",
        projectId: target.id,
        providerId: target.selection.providerId,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      const reason = rawError instanceof Error ? rawError.message : ""
      toast.error(reason.includes("内置 Claude Code runtime 缺失")
        ? "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。"
        : "无法在终端中启动 Claude Code。")
      return false
    }

    const openRequest = { requestId: createRequestId(), sessionId }
    if (isMainAppWindow()) {
      requestOpenTerminalSession(openRequest)
      return true
    }

    try {
      await bridge.apps.openSystemApp("terminal", {
        terminalOpenRequest: openRequest,
      })
    } catch (rawError) {
      logger.warn("Claude Code terminal window open failed.", {
        boundary: "renderer.agent.claude-code-terminal.window",
        projectId: target.id,
        sessionId,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      toast.error("Claude Code 已启动，但无法打开终端应用。")
    }
    return true
  }, [])

  return { openProjectInTerminal, startClaudeCodeTerminal }
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { useAgentProjectTerminalActions }
