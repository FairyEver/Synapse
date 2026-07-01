import { useEffect, useRef, useState } from "react"
import { Check, LoaderCircle, Trash2 } from "lucide-react"

import { RelativeTime } from "@/components/relative-time"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

  const status = running ? (
    <span className="inline-grid size-6 place-items-center text-muted-foreground" aria-label="正在输出">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
    </span>
  ) : unread > 0 ? (
    <span
      className="inline-grid size-6 place-items-center"
      aria-label="未读"
    >
      <span
        className="size-2 rounded-full bg-blue-500"
        aria-hidden="true"
      />
    </span>
  ) : updatedAt ? (
    <RelativeTime
      value={updatedAt}
      fallback=""
      className="block min-w-0 max-w-full truncate text-xs text-muted-foreground"
    />
  ) : null

  return (
    <span className="relative flex h-6 w-full min-w-0 items-center justify-end">
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center justify-end",
          canDelete && "transition-opacity duration-150 ease-out group-hover/item:opacity-0 group-focus-within/item:opacity-0",
        )}
      >
        {status}
      </span>
      {canDelete ? (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 inline-grid size-6 place-items-center opacity-0 transition-opacity duration-150 ease-out group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100"
        >
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="icon-xs"
            tabIndex={-1}
            title={armed ? "确认删除" : "删除会话"}
            className={cn(
              "transition-colors",
              armed ? "text-destructive" : "text-muted-foreground hover:text-destructive",
            )}
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
          </Button>
        </span>
      ) : null}
    </span>
  )
}

export { SessionTrailing }
