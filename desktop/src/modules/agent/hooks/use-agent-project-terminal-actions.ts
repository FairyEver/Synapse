import { useCallback } from "react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"

const logger = createRendererLogger("agent.terminal-actions")

type AgentProjectTerminalTarget = {
  readonly id: string
  readonly path: string
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `agent-terminal-${Date.now().toString(36)}`
}

function useAgentProjectTerminalActions() {
  const openProjectInTerminal = useCallback(async (project: AgentProjectTerminalTarget) => {
    const bridge = requireSynapseBridge()
    let sessionId: string
    try {
      const session = await bridge.terminal.session.create({ cwd: project.path })
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

  return { openProjectInTerminal }
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { useAgentProjectTerminalActions }
