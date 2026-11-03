import { useEffect, useRef, useState } from "react"
import { ImageIcon, X } from "lucide-react"
import type { TodoImageVariant } from "@synapse/shared/todo-contracts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { todosApi } from "@/lib/todos-api"
import { cn } from "@/lib/utils"
import type { TodoDraftImage } from "./todo-image-files"

function TodoImage({ image, todoId, variant, label }: {
  image: TodoDraftImage; todoId?: string; variant: TodoImageVariant; label: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const anchor = useRef<HTMLSpanElement>(null)
  const original = variant === "original"
  useEffect(() => {
    let active = true
    let url: string | null = null
    setSrc(null)
    setFailed(false)
    const show = (blob: Blob) => {
      if (!active) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }
    const load = async () => {
      try {
        if (image.file) show(image.file)
        else if (todoId) {
          const { bytes, mimeType } = await todosApi.readImage({ todoId, imageId: image.id, variant })
          show(new Blob([new Uint8Array(bytes)], { type: mimeType }))
        } else setFailed(true)
      } catch {
        if (active) setFailed(true)
      }
    }
    let observer: IntersectionObserver | undefined
    if (!image.file && !original && anchor.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        observer?.disconnect()
        void load()
      })
      observer.observe(anchor.current)
    } else void load()
    return () => {
      active = false
      observer?.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [attempt, image.file, image.id, original, todoId, variant])

  return <span ref={anchor} className={cn("grid w-full place-items-center", original ? "min-h-32" : "h-full")}>
    {failed
      ? original
        ? <span className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            图片无法读取
            <Button type="button" variant="outline" data-track="todos.image.retry" onClick={() => setAttempt(value => value + 1)}>重试</Button>
          </span>
        : <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      : src
        ? <img src={src} alt={original ? label : ""} draggable={false} onError={() => setFailed(true)}
            className={original ? "block max-h-[65dvh] max-w-full object-contain" : "block size-full object-cover"} />
        : <span aria-hidden="true" className={cn("animate-pulse bg-accent motion-reduce:animate-none", original ? "h-32 w-full rounded-md" : "size-full")} />}
  </span>
}

export function TodoImageStrip({ images, todoId, limit = images.length, disabled, onRemove }: {
  images: TodoDraftImage[]; todoId?: string; limit?: number; disabled?: boolean; onRemove?: (id: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const index = images.findIndex(image => image.id === activeId)
  const active = images[index]
  const open = (image: TodoDraftImage, button: HTMLButtonElement) => {
    trigger.current = button
    setActiveId(image.id)
  }
  const step = (direction: number) => {
    const next = images[index + direction]
    if (next) setActiveId(next.id)
  }
  if (!images.length) return null
  return <>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="图片附件">
      {images.slice(0, limit).map((image, position) => <div key={image.id} className="relative shrink-0">
        <button type="button" aria-label={`预览图片 ${position + 1}`} data-track="todos.image.preview"
          className="block h-10 w-14 overflow-hidden rounded-md border bg-muted hover:border-ring focus-visible:outline-2 focus-visible:outline-ring sm:h-12 sm:w-17"
          onClick={event => open(image, event.currentTarget)}>
          <TodoImage image={image} todoId={todoId} variant="thumbnail" label="" />
        </button>
        {onRemove && <Button type="button" variant="outline" size="icon-xs" className="absolute top-0.5 right-0.5 bg-background"
          aria-label={`移除图片 ${position + 1}`} data-track="todos.image.remove" disabled={disabled} onClick={() => onRemove(image.id)}>
          <X />
        </Button>}
      </div>)}
      {images.length > limit && <Button type="button" variant="outline" data-track="todos.image.more"
        aria-label={`查看其余 ${images.length - limit} 张图片`} onClick={event => open(images[limit]!, event.currentTarget)}>
        +{images.length - limit}
      </Button>}
    </div>
    <Dialog open={!!active} onOpenChange={value => { if (!value) setActiveId(null) }}>
      {active && <DialogContent aria-describedby={undefined} className="sm:max-w-3xl"
        onCloseAutoFocus={event => {
          if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus() }
        }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault()
            step(event.key === "ArrowLeft" ? -1 : 1)
          }
        }}>
        <DialogHeader><DialogTitle>图片预览</DialogTitle></DialogHeader>
        <div className="min-w-0 rounded-md bg-muted p-2">
          <TodoImage key={active.id} image={active} todoId={todoId} variant="original" label={`图片 ${index + 1}`} />
        </div>
        {images.length > 1 && <DialogFooter className="items-center sm:justify-center">
          <Button type="button" variant="outline" data-track="todos.image.previous" disabled={index === 0} onClick={() => step(-1)}>上一张</Button>
          <span className="min-w-12 text-center text-sm text-muted-foreground tabular-nums" aria-live="polite">{index + 1} / {images.length}</span>
          <Button type="button" variant="outline" data-track="todos.image.next" disabled={index + 1 === images.length} onClick={() => step(1)}>下一张</Button>
        </DialogFooter>}
      </DialogContent>}
    </Dialog>
  </>
}
