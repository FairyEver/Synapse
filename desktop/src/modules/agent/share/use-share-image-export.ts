import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { AgentShareSettings } from "@/types/agent-share"
import { track } from "@/lib/ui-tracking"
import { captureShareImage, shareBlobBase64 } from "./image"

const logger = createRendererLogger("agent.share.image")
export function useShareImageExport(scope: string) {
  const [busy, setBusy] = useState<"copy" | "save" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    setBusy(null); setError(null)
    return () => { operation.current?.abort(); operation.current = null }
  }, [scope])

  const run = useCallback(async (paper: HTMLElement | null, settings: AgentShareSettings, action: "copy" | "save") => {
    if (!paper || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(action); setError(null)
    track({ component: "agent", name: "agent-share-image-export", action: "click", eventKey: "agent.share.image.export", metadata: { action, scale: settings.scale, width: settings.width } })
    try {
      const agent = requireBridgeDomain("agent")
      if (typeof agent.exportShareImage !== "function") throw new Error("请重启客户端后使用图片分享。")
      const blob = await captureShareImage(paper, settings.scale, action, controller.signal)
      const pngBase64 = await shareBlobBase64(blob)
      controller.signal.throwIfAborted()
      const fileName = `Synapse 对话-${settings.scale}x.png`
      const result = await agent.exportShareImage({ action, pngBase64, fileName })
      if (controller.signal.aborted) return
      if (result.success) toast(action === "copy" ? "图片已复制" : "图片已保存")
    } catch (cause) {
      if (controller.signal.aborted) return
      logger.warn("Agent share image failed.", { action, errorName: cause instanceof Error ? cause.name : typeof cause })
      setError(cause instanceof Error ? cause.message : "图片导出失败，请重试。")
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(null) }
    }
  }, [])
  return { busy, error, run }
}
