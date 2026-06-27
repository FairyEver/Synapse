import { useEffect, useRef, useState } from "react"
import { Check, LoaderCircle, Trash2 } from "lucide-react"

import { RelativeTime } from "@/components/relative-time"

function SessionTrailing({
  updatedAt,
  unread,
  running,
  canDelete,
  onDelete,
}: {
  readonly updatedAt?: string
  readonly unread: number
  readonly running: boolean
  readonly canDelete: boolean
  readonly onDelete: () => void
}) {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
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
      {running ? (
        <span className="text-muted-foreground group-hover/item:hidden" aria-label="正在输出">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        </span>
      ) : unread > 0 ? (
        <span
          className="size-2 rounded-full bg-blue-500 group-hover/item:hidden"
          aria-label="未读"
        />
      ) : updatedAt ? (
        <RelativeTime
          value={updatedAt}
          fallback=""
          className="text-xs text-muted-foreground group-hover/item:hidden"
        />
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
