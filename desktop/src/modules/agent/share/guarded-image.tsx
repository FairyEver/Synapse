import { createContext, useContext, useEffect, useState, type ComponentProps } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { AGENT_SHARE_MAX_PNG_BYTES } from "@/types/agent-share"
import type { ShareRenderResponse } from "../../../../app-capabilities/agent/shared/share"
import { shareImageDataByteSize } from "./image-resources"

type ShareImageReader = { read(url: string): Promise<string> }
export const AgentShareImageContext = createContext<ShareImageReader | undefined>(undefined)

/** Authorize remote resources before any DOM image can initiate a browser request. */
export function createShareImageReader(renderContext: ShareRenderResponse): ShareImageReader {
  const cache = new Map<string, Promise<string>>()
  const waiting: (() => void)[] = []
  let active = 0, bytes = 0
  return { read(url) {
    let result = cache.get(url)
    if (!result) {
      result = (async () => {
        if (active < 4) active++
        else await new Promise<void>(resolve => waiting.push(resolve))
        try {
          const agent = getSynapseBridge()?.agent
          if (!agent?.readShareImageResource) throw new Error("图片读取暂不可用")
          const { dataUrl } = await agent.readShareImageResource({ url, renderContext })
          if (!/^data:image\/[^;,]+;base64,/.test(dataUrl)) throw new Error("图片资源无法读取")
          const size = shareImageDataByteSize(dataUrl)
          bytes += size
          if (!size || size > AGENT_SHARE_MAX_PNG_BYTES || bytes > AGENT_SHARE_MAX_PNG_BYTES * 4) throw new Error("图片资源过大，请缩小分享范围。")
          return /^data:image\/svg\+xml;/i.test(dataUrl) ? dataUrl + new URL(url).hash : dataUrl
        } finally {
          const next = waiting.shift()
          if (next) next()
          else active--
        }
      })()
      cache.set(url, result)
    }
    return result
  } }
}

export function AgentShareImage({ src, alt, className, width, height, title }: ComponentProps<"img"> & { node?: unknown }) {
  const reader = useContext(AgentShareImageContext)
  let remote: string | undefined
  if (reader && typeof src === "string") {
    try { const url = new URL(src, document.baseURI); if (/^https?:$/.test(url.protocol)) remote = url.href }
    catch { remote = undefined }
  }
  const [loaded, setLoaded] = useState<{ url: string; data?: string; error?: boolean }>()
  useEffect(() => {
    if (!reader || !remote) return
    let current = true
    const url = remote
    void reader.read(url).then(data => { if (current) setLoaded({ url, data }) }, () => { if (current) setLoaded({ url, error: true }) })
    return () => { current = false }
  }, [reader, remote])
  if (reader && remote) {
    if (loaded?.url !== remote) return <span data-agent-render-pending>加载中</span>
    if (loaded.error || !loaded.data) return <span data-agent-render-error>图片无法加载</span>
  } else if (reader && (typeof src !== "string" || !/^(?:data:image\/|blob:|file:|synapse-agent-artifact:)/i.test(src))) {
    return <span data-agent-render-error>图片无法加载</span>
  }
  return <img src={reader && remote ? loaded?.data : src} alt={alt} className={className} width={width} height={height} title={title} loading="eager" />
}
