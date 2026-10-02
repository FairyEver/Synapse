import { NOTIFICATION_SOURCES } from "@synapse/shared/notification-constants"
import type { CapabilityDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

const entries = [
  ["list", "List account notifications by all, unread, or pending filter and optional source. Both filters apply together. Pagination: cursor-based. Continue with nextCursor and the same filters; restart without cursor when a filter changes."],
  ["count", "Get the exact unread notification count."],
  ["get", "Read one notification without marking it read. Pass either id or the complete copied synapse:notification:<id> reference."],
  ["read", "Mark one notification read."],
  ["read_all", "Mark every unread notification read."],
  ["delete", "Hide one notification for the current account."],
  ["delete_all", "Hide all notifications, or all pending notifications, for the current account."],
] as const

export const notificationCapabilities: CapabilityDefinition[] = entries.map(([action, description]) => ({
  id: `app.account.notification.${action}` as CapabilityId,
  title: description,
  description,
  mutates: !["list", "count", "get"].includes(action),
  ...(action === "delete_all" ? { risk: "high" as const } : {}),
}))

export const notificationToolActions: Record<string, string> = Object.fromEntries(entries.map(([action]) => [
  `app_account_notification_${action}`,
  `app.account.notification.${action}`,
]))

const id = { type: "string", minLength: 1, description: "Notification ID from list." }
const empty = { type: "object" as const, properties: {}, additionalProperties: false }

export function buildNotificationTools(): McpToolDefinition[] {
  return entries.map(([action, description]) => ({
    name: `app_account_notification_${action}`,
    description,
    inputSchema: action === "list" ? {
      type: "object", properties: { filter: { type: "string", enum: ["all", "unread", "pending"], description: "Defaults to all." }, source: { type: "string", enum: [...NOTIFICATION_SOURCES], description: "Optional notification source. Omit for all sources; pending only matches terminal-attention." }, cursor: { type: "string", description: "nextCursor from the prior page with the same filter and source." } }, additionalProperties: false,
    } : action === "get" ? {
      type: "object", properties: { id: { ...id, description: "Notification ID. Use this or reference, not both." }, reference: { type: "string", description: "Complete copied synapse:notification:<id> reference. Pass unchanged; use this or id, not both." } }, additionalProperties: false,
    } : action === "read" || action === "delete" ? {
      type: "object", properties: { id }, required: ["id"], additionalProperties: false,
    } : action === "delete_all" ? {
      type: "object", properties: { filter: { type: "string", enum: ["all", "pending"] } }, required: ["filter"], additionalProperties: false,
    } : empty,
  }))
}
