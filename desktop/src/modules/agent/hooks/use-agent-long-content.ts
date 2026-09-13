import { useEffect, useRef, useState } from "react"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"

// 全文窗口只保留一个 64 KiB 正文段和最近 128 个 UTF-16 游标。
export const AGENT_CONTENT_CHUNK_BYTES = 64 * 1024
export const AGENT_CONTENT_PREVIOUS_CURSOR_LIMIT = 128
const logger = createRendererLogger("agent.long-content")

type Target = { readonly projectId: string; readonly conversationId: string; readonly historyIndex: number }
const emptyPage = { content: "", offset: 0, nextOffset: 0, done: false, previousOffsets: [] as number[] }

export function useAgentLongContent(target: Target) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(emptyPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epochRef = useRef(0)
  const busyRef = useRef(false)
  const failedLoadRef = useRef<{ offset: number; previousOffsets: number[] } | null>(null)
  const { projectId, conversationId, historyIndex } = target

  useEffect(() => {
    epochRef.current += 1
    busyRef.current = false
    failedLoadRef.current = null
    setOpen(false)
    setPage(emptyPage)
    setLoading(false)
    setError(null)
    return () => { epochRef.current += 1 }
  }, [projectId, conversationId, historyIndex])

  const load = async (offset: number, previousOffsets: number[]) => {
    if (busyRef.current) return
    busyRef.current = true
    setLoading(true)
    setError(null)
    const epoch = epochRef.current
    try {
      const chunk = await requireBridgeDomain("agent").getTimelineContentChunk({
        projectId, conversationId, historyIndex, offset, maxBytes: AGENT_CONTENT_CHUNK_BYTES,
      })
      if (epoch !== epochRef.current) return
      failedLoadRef.current = null
      setPage({ content: chunk.content, offset, nextOffset: chunk.nextOffset, done: chunk.done, previousOffsets })
    } catch (cause) {
      if (epoch !== epochRef.current) return
      failedLoadRef.current = { offset, previousOffsets }
      logger.warn("Agent content chunk load failed.", {
        projectId, conversationId, historyIndex, offset,
        errorName: cause instanceof Error ? cause.name : typeof cause,
      })
      setError("加载失败，请重试")
    } finally {
      if (epoch === epochRef.current) {
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void load(0, [])
    } else {
      epochRef.current += 1
      busyRef.current = false
      failedLoadRef.current = null
      setPage(emptyPage)
      setLoading(false)
      setError(null)
    }
  }

  return {
    open, onOpenChange, content: page.content, loading, error,
    canGoPrevious: page.offset > 0,
    canGoNext: !page.done,
    previousLabel: page.previousOffsets.length > 0 ? "上一段" : "返回开头",
    previous: () => load(page.previousOffsets.at(-1) ?? 0, page.previousOffsets.slice(0, -1)),
    next: () => load(page.nextOffset, [...page.previousOffsets, page.offset].slice(-AGENT_CONTENT_PREVIOUS_CURSOR_LIMIT)),
    retry: () => load(failedLoadRef.current?.offset ?? page.offset, failedLoadRef.current?.previousOffsets ?? page.previousOffsets),
  }
}
