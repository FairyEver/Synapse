import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  attachmentDisplayName,
  attachmentMetadata,
  type AgentDraftAttachment,
} from "../attachments"

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

  const scrollAttachments = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollBy({
      left: direction * Math.max(1, viewport.clientWidth - 48),
      behavior: "smooth",
    })
  }

  return (
    <div
      className="agent-composer-attachment-strip relative min-w-0"
      role="list"
      aria-label="附件"
    >
      <div
        ref={viewportRef}
        className="agent-composer-attachment-strip__viewport min-w-0 overflow-x-hidden"
        onScroll={updateScrollControls}
      >
        <div ref={contentRef} className="flex w-max min-w-full flex-nowrap gap-2">
          {attachments.map((attachment, index) => {
            const displayName = attachmentDisplayName(attachments, attachment, index)
            const title = attachment.kind === "path" ? attachment.path : attachment.name ?? displayName
            return (
              <div
                key={attachment.id}
                className="group relative flex h-14 w-44 shrink-0 flex-col justify-center rounded-lg bg-muted/60 px-3 pr-10 text-left transition-colors duration-150 ease-out hover:bg-muted focus-within:bg-muted"
                title={title}
                role="listitem"
              >
                <span className="truncate text-sm font-medium leading-tight">{displayName}</span>
                <span className="truncate text-xs leading-tight tabular-nums text-muted-foreground">
                  {attachmentMetadata(attachment)}
                </span>
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
                  onClick={() => onRemove(attachment.id)}
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
  )
}

export { AgentComposerAttachmentStrip }
export type { AgentComposerAttachmentStripProps }
