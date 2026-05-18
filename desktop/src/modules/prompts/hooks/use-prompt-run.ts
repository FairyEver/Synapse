import { useCallback, useState } from "react"
import { toast } from "sonner"
import { readContent } from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { requestOpenAgentSession } from "@/app-shell/navigation"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseContentMeta } from "@/types/content"

const logger = createRendererLogger("prompts.run")

type PromptRunArgs = {
  item: SynapseContentMeta<"prompt">
  projectId: string
  agentType: string
  providerId: string
  navigate: boolean
}

function usePromptRun() {
  const [isRunning, setIsRunning] = useState(false)

  const run = useCallback(async (args: PromptRunArgs): Promise<boolean> => {
    const { item, projectId, agentType, providerId, navigate } = args
    setIsRunning(true)

    try {
      let content: string
      try {
        const file = await readContent("prompt", item.id)
        content = file.content
      } catch (error) {
        logger.error("Prompt run: read content failed.", {
          promptId: item.id,
          boundary: "renderer.prompt-run.read-content",
          ...errorLogMeta(error),
        })
        toast.error("读取提示词失败")
        return false
      }

      const bridge = requireSynapseBridge()
      const now = new Date().toISOString()

      let session: Awaited<ReturnType<typeof bridge.agent.createSession>>
      try {
        session = await bridge.agent.createSession({
          projectId,
          name: `${item.title} ${now}`,
          agentType,
          providerId,
        })
      } catch (error) {
        logger.error("Prompt run: create session failed.", {
          promptId: item.id,
          projectId,
          agentType,
          providerId,
          boundary: "renderer.prompt-run.create-session",
          ...errorLogMeta(error),
        })
        toast.error("创建会话失败")
        return false
      }

      if (navigate) {
        requestOpenAgentSession({ projectId, conversationId: session.id, prompt: content })
      } else {
        toast("已发送到 Agent")
        bridge.agent.send({
          projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          content,
          clientSubmittedAt: now,
          providerId,
        }).catch((error) => {
          logger.error("Prompt run: send message failed.", {
            promptId: item.id,
            projectId,
            conversationId: session.id,
            sessionKey: session.sessionKey,
            agentType,
            providerId,
            boundary: "renderer.prompt-run.agent-send",
            ...errorLogMeta(error),
          })
          toast.error("发送失败")
        })
      }

      return true
    } finally {
      setIsRunning(false)
    }
  }, [])

  return { run, isRunning }
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { usePromptRun }
export type { PromptRunArgs }
