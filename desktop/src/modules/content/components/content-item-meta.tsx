import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type ContentItemMetaProps = {
  author: string
  category: string
  className?: string
  description: string
  descriptionWrap?: boolean
  title: string
}

type ContentItemTextProps = {
  description: string
  descriptionWrap?: boolean
  title: string
}

type ContentItemBadgesProps = {
  author: string
  category: string
  className?: string
}

function ContentItemText({
  description,
  descriptionWrap,
  title,
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
      <div className="min-w-0 flex flex-col gap-1.5">
        <p className="truncate text-sm font-medium leading-4 text-foreground">{title}</p>
        <p
          ref={descRef}
          className={cn(
            "text-sm leading-4 text-muted-foreground",
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
          <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="sr-only">完整介绍</DialogDescription>
            </DialogHeader>
            <p className="whitespace-pre-wrap break-words text-sm leading-5 text-muted-foreground">
              {description}
            </p>
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
  descriptionWrap,
  title,
}: ContentItemMetaProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <ContentItemText
        description={description}
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
