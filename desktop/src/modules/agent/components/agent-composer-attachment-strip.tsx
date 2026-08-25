import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { formatBytes } from "@synapse/shared"

import { Button } from "@/components/ui/button"
import { ImageLightbox, type ImageLightboxPreview } from "@/components/image-lightbox"
import { cn } from "@/lib/utils"
import {
  attachmentDisplayName,
  attachmentMetadata,
  type AgentDraftAttachment,
  type AgentDraftImageAttachment,
} from "../attachments"
import { AgentComposerImageThumbnail } from "./agent-composer-image-thumbnail"

const contextualControlTransition = "transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:active:scale-100"

type AgentComposerAttachmentStripProps = {
  readonly attachments: readonly AgentDraftAttachment[]
  readonly onRemove: (id: string) => void
}

function AgentComposerAttachmentStrip({
  attachments,
  onRemove,
}: AgentComposerAttachmentStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [preview, setPreview] = useState<ImageLightboxPreview | null>(null)
  const imageCount = attachments.filter((attachment) => attachment.kind === "image").length
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.byteSize, 0)
  const imageBytes = attachments.reduce(
    (total, attachment) => total + (attachment.kind === "image" ? attachment.byteSize : 0),
    0,
  )
  const summary = imageCount > 0
    ? `${imageCount} 张图片 · ${formatBytes(imageBytes)}`
    : `${attachments.length} 个附件 · ${formatBytes(totalBytes)}`

  const updateScrollControls = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    setCanScrollLeft(viewport.scrollLeft > 1)
    setCanScrollRight(viewport.scrollLeft < maxScrollLeft - 1)
  }, [])

  useEffect(() => {
    updateScrollControls()
    if (typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver(updateScrollControls)
    if (viewportRef.current) observer.observe(viewportRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [attachments.length, updateScrollControls])

  useEffect(() => {
    setPreview(null)
  }, [attachments])

  const scrollAttachments = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollBy({
      left: direction * Math.max(1, viewport.clientWidth - 48),
      behavior: "smooth",
    })
  }

  const openImagePreview = (
    attachment: AgentDraftImageAttachment,
    trigger: HTMLButtonElement,
  ) => {
    const images = attachments.flatMap((candidate, index) => {
      if (candidate.kind !== "image") return []
      return [{
        attachmentId: candidate.attachmentId,
        image: {
          alt: attachmentDisplayName(attachments, candidate, index),
          src: candidate.previewUrl,
        },
      }]
    })
    const initialIndex = images.findIndex((item) => item.attachmentId === attachment.attachmentId)
    if (initialIndex < 0) return
    setPreview({
      images: images.map((item) => item.image),
      initialIndex,
      trigger,
    })
  }

  return (
    <>
      <div
        className="agent-composer-attachment-strip relative min-w-0"
        role="list"
        aria-label="附件"
      >
        <p className="mb-1 px-0.5 text-xs tabular-nums text-muted-foreground">{summary}</p>
        <div
          ref={viewportRef}
          className="agent-composer-attachment-strip__viewport min-w-0 overflow-x-hidden"
          onScroll={updateScrollControls}
        >
          <div ref={contentRef} className="flex w-max min-w-full flex-nowrap gap-2">
            {attachments.map((attachment, index) => {
              const displayName = attachmentDisplayName(attachments, attachment, index)
              const title = attachment.kind === "directory" ? attachment.path : attachment.name
              return (
                <div
                  key={attachment.attachmentId}
                  className={cn(
                    "group relative flex h-14 shrink-0 rounded-lg bg-muted/60 text-left transition-colors duration-150 ease-out hover:bg-muted focus-within:bg-muted",
                    attachment.kind === "image"
                      ? "w-52 items-center gap-2 p-2 pr-10"
                      : "w-44 flex-col justify-center px-3 pr-10",
                  )}
                  title={title}
                  role="listitem"
                >
                  {attachment.kind === "image" ? (
                    <AgentComposerImageThumbnail
                      displayName={displayName}
                      imageUrl={attachment.thumbnailUrl}
                      onOpen={(trigger) => openImagePreview(attachment, trigger)}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
                    <p className="truncate text-xs leading-tight tabular-nums text-muted-foreground">
                      {attachmentMetadata(attachment)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="icon-xs"
                    className={cn(
                      contextualControlTransition,
                      "absolute right-2 top-2 scale-[0.25] opacity-0 after:absolute after:-inset-2 after:content-[''] active:scale-[0.96] group-hover:scale-100 group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100",
                    )}
                    aria-label={`删除附件 ${displayName}`}
                    data-track="agent-attachment-remove"
                    onClick={() => onRemove(attachment.attachmentId)}
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            contextualControlTransition,
            "absolute left-1 top-1/2 -translate-y-1/2 rounded-full after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.96] active:not-aria-[haspopup]:-translate-y-1/2",
            canScrollLeft
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-[0.25] opacity-0",
          )}
          aria-label="向左查看附件"
          aria-hidden={!canScrollLeft}
          tabIndex={canScrollLeft ? 0 : -1}
          data-track="agent-attachments-scroll-left"
          onClick={() => scrollAttachments(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            contextualControlTransition,
            "absolute right-1 top-1/2 -translate-y-1/2 rounded-full after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.96] active:not-aria-[haspopup]:-translate-y-1/2",
            canScrollRight
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-[0.25] opacity-0",
          )}
          aria-label="向右查看附件"
          aria-hidden={!canScrollRight}
          tabIndex={canScrollRight ? 0 : -1}
          data-track="agent-attachments-scroll-right"
          onClick={() => scrollAttachments(1)}
        >
          <ChevronRight />
        </Button>
      </div>
      {preview ? (
        <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
      ) : null}
    </>
  )
}

export { AgentComposerAttachmentStrip }
export type { AgentComposerAttachmentStripProps }
