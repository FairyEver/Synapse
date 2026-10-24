import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ImageLightbox, type ImageLightboxPreview } from "@/components/image-lightbox"
import type { ShareImageSummary } from "../../../../app-capabilities/agent/shared/share"
import { useShareResultImage } from "./use-share-results"

export function AgentShareResult({ image }: { image: ShareImageSummary }) {
  const result = useShareResultImage(image)
  const [preview, setPreview] = useState<ImageLightboxPreview | null>(null)
  return <div ref={result.setElement} className="flex min-w-0 flex-col items-start gap-2 py-3" data-share-image-ref={image.shareImageRef}>
    {result.url ? <Button variant="ghost" className="h-auto max-w-full overflow-hidden rounded border border-border p-0" data-track="agent-share-result-preview" aria-label="预览对话图片" onClick={event => setPreview({ images: [{ src: result.url!, alt: image.fileName }], initialIndex: 0, trigger: event.currentTarget })}>
      <img src={result.url} alt={image.fileName} className="max-h-80 max-w-full object-contain" />
    </Button> : <p className="text-sm text-muted-foreground">{result.error ? "图片暂不可用" : "正在加载图片"}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" data-track="agent-share-result-copy" disabled={result.busy} onClick={() => void result.output("copy")}>复制图片</Button>
      <Button variant="outline" data-track="agent-share-result-save" disabled={result.busy} onClick={() => void result.output("save")}>保存图片</Button>
      {result.status ? <span role="status" className="text-sm text-muted-foreground">{result.status}</span> : null}
    </div>
    {result.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p> : null}
    {preview ? <ImageLightbox preview={preview} onClose={() => setPreview(null)} /> : null}
  </div>
}
