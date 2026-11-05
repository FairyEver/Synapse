import type { MainNavigationTarget } from "../modules/apps/main-navigation"
import type { SynapseNotification } from "../types/notification-center"

export function resolveNotificationDestination(
  item: Pick<SynapseNotification, "source" | "targetId" | "deviceId">,
  requestId: string,
  localDeviceId: string | null,
): MainNavigationTarget | "other-device" | null {
  if (!item.targetId) return null
  switch (item.source) {
    case "terminal-attention":
    case "terminal-complete":
      if (item.deviceId && item.deviceId !== localDeviceId) return "other-device"
      return { appId: "terminal", target: { requestId, sessionId: item.targetId } }
    case "meeting-transcription":
      return { appId: "meeting", target: item.targetId }
    case "todo-reminder":
      return { appId: "todos", target: { requestId, id: item.targetId } }
    case "mail-internal":
      return { appId: "mail-internal", target: { requestId, messageId: item.targetId } }
    default:
      return null
  }
}
