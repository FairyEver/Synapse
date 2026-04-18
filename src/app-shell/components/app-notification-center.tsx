import { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import type { AppNotificationRecord } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const DEFAULT_NOTIFICATION_HEIGHT_PX = 88
const NOTIFICATION_GAP_PX = 12
const NOTIFICATION_VIEWPORT_WIDTH_PX = 340

type AppNotificationCenterProps = {
  notifications: AppNotificationRecord[]
  now: number
  onDismiss: (id: AppNotificationRecord["id"]) => void
}

function AppNotificationCenter({
  notifications,
  now,
  onDismiss,
}: AppNotificationCenterProps) {
  const [heights, setHeights] = useState<Record<string, number>>({})

  useEffect(() => {
    setHeights((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => notifications.some((notification) => String(notification.id) === id)),
      )
      const currentKeys = Object.keys(current).sort().join("|")
      const nextKeys = Object.keys(next).sort().join("|")

      return currentKeys === nextKeys ? current : next
    })
  }, [notifications])

  const layout = useMemo(() => {
    const offsets = new Map<AppNotificationRecord["id"], number>()
    let totalHeight = 0

    for (let index = notifications.length - 1; index >= 0; index -= 1) {
      const notification = notifications[index]
      offsets.set(notification.id, totalHeight)
      totalHeight += (heights[String(notification.id)] ?? DEFAULT_NOTIFICATION_HEIGHT_PX) + NOTIFICATION_GAP_PX
    }

    return {
      offsets,
      totalHeight: totalHeight > 0 ? totalHeight - NOTIFICATION_GAP_PX : 0,
    }
  }, [heights, notifications])

  if (notifications.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none fixed right-6 bottom-6 z-50"
      style={{
        height: layout.totalHeight || DEFAULT_NOTIFICATION_HEIGHT_PX,
        width: NOTIFICATION_VIEWPORT_WIDTH_PX,
      }}
    >
      {notifications.map((notification) => (
        <AppNotificationItem
          key={notification.id}
          notification={notification}
          offset={layout.offsets.get(notification.id) ?? 0}
          now={now}
          onDismiss={onDismiss}
          onHeightChange={(height) => {
            setHeights((current) => (
              current[notification.id] === height
                || current[String(notification.id)] === height
                ? current
                : {
                    ...current,
                    [String(notification.id)]: height,
                  }
            ))
          }}
        />
      ))}
    </div>
  )
}

function AppNotificationItem({
  notification,
  offset,
  now,
  onDismiss,
  onHeightChange,
}: {
  notification: AppNotificationRecord
  offset: number
  now: number
  onDismiss: (id: AppNotificationRecord["id"]) => void
  onHeightChange: (height: number) => void
}) {
  const itemRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const node = itemRef.current

    if (!node) {
      return
    }

    const syncHeight = () => {
      onHeightChange(Math.ceil(node.getBoundingClientRect().height))
    }

    syncHeight()

    const observer = new ResizeObserver(() => {
      syncHeight()
    })
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [onHeightChange])

  const remainingMs = notification.isClosing
    ? 0
    : Math.max(0, notification.dismissAt - now)
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
  const progress = notification.durationMs > 0
    ? Math.max(0, Math.min(1, remainingMs / notification.durationMs))
    : 0
  const translateY = notification.isClosing || !isVisible
    ? 16 - offset
    : -offset

  return (
    <div
      ref={itemRef}
      className={cn(
        "pointer-events-auto absolute right-0 bottom-0 w-full rounded-xl border bg-card transition-[opacity,transform] duration-200 ease-out",
        notification.tone === "destructive" ? "border-destructive/30" : "border-border",
      )}
      style={{
        opacity: notification.isClosing || !isVisible ? 0 : 1,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm leading-5",
              notification.tone === "destructive" ? "text-destructive" : "text-foreground",
            )}
          >
            {notification.message}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs tabular-nums text-muted-foreground">
            {remainingSeconds}s
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="关闭通知"
            onClick={() => onDismiss(notification.id)}
          >
            <X />
            <span className="sr-only">关闭通知</span>
          </Button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full origin-left rounded-full transition-transform duration-100 ease-linear",
              notification.tone === "destructive" ? "bg-destructive/60" : "bg-foreground/25",
            )}
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>
    </div>
  )
}

export { AppNotificationCenter }
