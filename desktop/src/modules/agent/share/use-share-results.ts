import { useEffect, useState } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { ShareImageSummary } from "../../../../app-capabilities/agent/shared/share"

export function useShareResults(projectId?: string, conversationId?: string) {
  const [state, setState] = useState<{ key: string; images: ShareImageSummary[]; error: string | null }>({ key: "", images: [], error: null })
  const key = JSON.stringify([projectId, conversationId])
  useEffect(() => {
    const agent = getSynapseBridge()?.agent
    if (!projectId || !conversationId || !agent?.listShareImages) return
    let disposed = false, revision = 0
    async function load() {
      const current = ++revision
      try {
        const images: ShareImageSummary[] = []
        let page: ShareImageSummary[]
        do {
          page = await agent!.listShareImages({ projectId: projectId!, conversationId: conversationId!, offset: images.length })
          if (disposed || current !== revision) return
          images.push(...page)
        } while (page.length === 100)
        setState({ key, images, error: null })
      } catch (cause) { if (!disposed && current === revision) setState(previous => ({ key, images: previous.key === key ? previous.images : [], error: cause instanceof Error ? cause.message : "分享图片加载失败" })) }
    }
    void load()
    const unsubscribe = agent.onShareEvent(event => { if (event.type === "shareImagesChanged" && event.payload.projectId === projectId && event.payload.conversationId === conversationId) void load() })
    return () => { disposed = true; unsubscribe() }
  }, [key, projectId, conversationId])
  return state.key === key ? state : { key, images: [], error: null }
}

export function useShareResultImage(image: ShareImageSummary) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [element, setElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!element) return
    let disposed = false, objectUrl: string | undefined, started = false
    const load = async () => {
      if (started) return
      started = true
      try {
        const data = await getSynapseBridge()!.agent.readShareImage({ projectId: image.projectId, conversationId: image.conversationId, shareImageRef: image.shareImageRef })
        if (disposed) return
        const bytes = Uint8Array.from(atob(data.pngBase64), c => c.charCodeAt(0))
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" })); setUrl(objectUrl)
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "图片加载失败") }
    }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load() } }, { rootMargin: "400px" })
    observer.observe(element)
    return () => { disposed = true; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [element, image.shareImageRef])
  async function output(action: "copy" | "save") {
    setBusy(true); setError(null); setStatus(null)
    try {
      const result = await getSynapseBridge()!.agent.outputShareImage({ projectId: image.projectId, conversationId: image.conversationId, shareImageRef: image.shareImageRef, action })
      setStatus(result.success ? action === "copy" ? "已复制" : "已保存" : "已取消")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片输出失败") }
    finally { setBusy(false) }
  }
  return { url, error, status, busy, setElement, output }
}
