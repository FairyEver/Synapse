import { useEffect, useRef, useState } from "react"
import { Check, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

function formatRelativeTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then
  if (diffMs < 0) return "刚刚"

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天`

  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks} 周`

  const months = Math.floor(days / 30)
  return `${months} 月`
}

function SessionTrailing({
  updatedAt,
  unread,
  canDelete,
  onDelete,
}: {
  readonly updatedAt?: string
  readonly unread: number
  readonly canDelete: boolean
  readonly onDelete: () => void
}) {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!armed) return undefined
    timerRef.current = setTimeout(() => setArmed(false), 3000)
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setArmed(false)
      }
    }
    document.addEventListener("pointerdown", handleClickOutside, true)
    return () => {
      clearTimeout(timerRef.current)
      document.removeEventListener("pointerdown", handleClickOutside, true)
    }
  }, [armed])

  return (
    <span className="flex items-center gap-1">
      {unread > 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {unread}
          <span className="sr-only"> 条未读</span>
        </Badge>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted-foreground group-hover/item:hidden">
          {formatRelativeTime(updatedAt)}
        </span>
      ) : null}
      {canDelete ? (
        <button
          ref={buttonRef}
          type="button"
          title={armed ? "确认删除" : "删除会话"}
          className={`hidden rounded p-0.5 group-hover/item:block ${armed ? "text-destructive" : "text-muted-foreground hover:text-destructive"}`}
          onClick={(event) => {
            event.stopPropagation()
            if (armed) {
              setArmed(false)
              onDelete()
            } else {
              setArmed(true)
            }
          }}
        >
          {armed ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
          <span className="sr-only">{armed ? "确认删除" : "删除会话"}</span>
        </button>
      ) : null}
    </span>
  )
}

export { SessionTrailing }
