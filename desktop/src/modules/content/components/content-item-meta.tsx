import { useEffect, useRef, useState, type ReactNode } from "react"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type ContentItemMetaProps = {
  author: string
  category: string
  className?: string
  description: string
  descriptionTextClassName?: string
  descriptionWrap?: boolean
  title: string
}

type ContentItemTextProps = {
  description: string
  descriptionTextClassName?: string
  descriptionWrap?: boolean
  title: string
  titleAccessory?: ReactNode
}

type ContentItemBadgesProps = {
  author: string
  category: string
  className?: string
}

function ContentItemText({
  description,
  descriptionTextClassName,
  descriptionWrap,
  title,
  titleAccessory,
}: ContentItemTextProps) {
  const descRef = useRef<HTMLParagraphElement>(null)
  const [isClamped, setIsClamped] = useState(false)
  const [showFull, setShowFull] = useState(false)

  useEffect(() => {
    if (!descriptionWrap) return
    const el = descRef.current
    if (!el) return

    const check = () => {
      setIsClamped(el.scrollHeight > el.clientHeight)
    }
    check()

    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [description, descriptionWrap])

  return (
    <>
      <div className="min-w-0 w-full max-w-full flex flex-col gap-1.5">
        <div className="flex min-w-0 max-w-full items-center gap-1.5">
          <p className="min-w-0 truncate text-sm font-medium leading-4 text-foreground">{title}</p>
          {titleAccessory}
        </div>
        <p
          ref={descRef}
          className={cn(
            "max-w-full leading-4 text-muted-foreground",
            descriptionTextClassName ?? "text-sm",
            descriptionWrap ? "line-clamp-3 break-words whitespace-pre-wrap" : "truncate",
          )}
        >
          {description}
        </p>
        {descriptionWrap && isClamped && (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowFull(true)}
          >
            ...更多
          </button>
        )}
      </div>
      {descriptionWrap && (
        <Dialog open={showFull} onOpenChange={setShowFull}>
          <DialogContent className="max-h-[70vh] overflow-hidden p-0 sm:max-w-[500px]" showCloseButton={false}>
            <DialogFrame className="max-h-[70vh]">
              <DialogFrameHeader title={title}>
                <DialogDescription className="sr-only">完整介绍</DialogDescription>
              </DialogFrameHeader>
              <DialogFrameBody>
                <ScrollArea
                  className="h-full min-h-0 max-h-[calc(70vh-4rem)] max-w-full"
                  viewportClassName="max-h-[calc(70vh-4rem)]"
                >
                  <div
                    data-content-full-description="true"
                    className="min-w-0 max-w-full px-5 py-4"
                  >
                    <MarkdownViewer content={description} showTabs={false} surface="plain" />
                  </div>
                </ScrollArea>
              </DialogFrameBody>
            </DialogFrame>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function ContentItemBadges({ author, category, className }: ContentItemBadgesProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Badge variant="outline" className="max-w-full truncate">
        @{author}
      </Badge>
      <Badge variant="secondary" className="max-w-full truncate">
        {category}
      </Badge>
    </div>
  )
}

function ContentItemMeta({
  author,
  category,
  className,
  description,
  descriptionTextClassName,
  descriptionWrap,
  title,
}: ContentItemMetaProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <ContentItemText
        description={description}
        descriptionTextClassName={descriptionTextClassName}
        descriptionWrap={descriptionWrap}
        title={title}
      />
      <ContentItemBadges
        author={author}
        category={category}
        className="mt-2"
      />
    </div>
  )
}

export { ContentItemBadges, ContentItemMeta, ContentItemText }
