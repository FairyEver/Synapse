import { useEffect, useState } from "react"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

const logger = createRendererLogger("agent.generated-ui")
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

export function useGeneratedUiContent(item: SynapseAgentMessageTimelineItem, projectId?: string, conversationId?: string) {
  const [loaded, setLoaded] = useState<{ key: string; content?: string; error?: string }>()
  const key = `${projectId}:${conversationId}:${item.historyIndex}:${item.id}`
  const needsFullContent = Boolean(item.metadata?.generatedUi && item.contentTruncated && item.historyIndex !== undefined && projectId && conversationId)
  useEffect(() => {
    if (!needsFullContent || !projectId || !conversationId || item.historyIndex === undefined) return
    let cancelled = false
    const load = async () => {
      let offset = 0
      let content = ""
      let bytes = 0
      try {
        while (!cancelled) {
          const chunk = await requireBridgeDomain("agent").getTimelineContentChunk({ projectId, conversationId, historyIndex: item.historyIndex!, offset, maxBytes: 64 * 1024 })
          bytes += new TextEncoder().encode(chunk.content).byteLength
          if (bytes > MAX_MESSAGE_BYTES) throw new Error("回复过长，请查看全文。")
          content += chunk.content
          if (chunk.done) { if (!cancelled) setLoaded({ key, content }); return }
          if (chunk.nextOffset <= offset) throw new Error("界面内容加载失败。")
          offset = chunk.nextOffset
        }
      } catch (cause) {
        if (!cancelled) {
          logger.warn("agent.generated-ui.content.failed", { errorName: cause instanceof Error ? cause.name : typeof cause })
          setLoaded({ key, error: "界面内容无法加载，请查看全文。" })
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [key, needsFullContent, projectId, conversationId, item.historyIndex])
  return { content: needsFullContent ? loaded?.key === key ? loaded.content : undefined : item.content,
    error: loaded?.key === key ? loaded.error : undefined,
    loading: needsFullContent && loaded?.key !== key }
}
