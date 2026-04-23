import { useEffect, useRef } from "react"
import type { AppNotificationRecord } from "@/app-shell/notifications"
import { toast } from "sonner"

type AppNotificationCenterProps = {
  notifications: AppNotificationRecord[]
  now: number
  onDismiss: (id: AppNotificationRecord["id"]) => void
}

function syncNotificationToast(
  notification: AppNotificationRecord,
  onDismiss: (id: AppNotificationRecord["id"]) => void,
) {
  const options = {
    duration: notification.tone === "loading" ? undefined : notification.durationMs,
    id: notification.id,
    onDismiss: () => onDismiss(notification.id),
  }

  switch (notification.tone) {
    case "success":
      toast.success(notification.message, options)
      return
    case "info":
      toast.info(notification.message, options)
      return
    case "warning":
      toast.warning(notification.message, options)
      return
    case "destructive":
      toast.error(notification.message, options)
      return
    case "loading":
      toast.loading(notification.message, options)
      return
    default:
      toast(notification.message, options)
  }
}

function AppNotificationCenter({
  notifications,
  now: _now,
  onDismiss,
}: AppNotificationCenterProps) {
  const activeNotificationIdsRef = useRef<Set<AppNotificationRecord["id"]>>(new Set())

  useEffect(() => {
    const nextNotificationIds = new Set<AppNotificationRecord["id"]>()

    for (const notification of notifications) {
      nextNotificationIds.add(notification.id)

      if (notification.isClosing) {
        toast.dismiss(notification.id)
        continue
      }

      syncNotificationToast(notification, onDismiss)
    }

    for (const notificationId of activeNotificationIdsRef.current) {
      if (!nextNotificationIds.has(notificationId)) {
        toast.dismiss(notificationId)
      }
    }

    activeNotificationIdsRef.current = nextNotificationIds
  }, [notifications, onDismiss])

  return null
}

export { AppNotificationCenter }
