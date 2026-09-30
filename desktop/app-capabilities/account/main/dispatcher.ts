import { z } from "zod"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import type { SynapseAccountLoginResult, SynapseAccountState } from "../../../src/types/account"
import {
  ACCOUNT_LOGIN_START_CAPABILITY_ID,
  ACCOUNT_STATE_GET_CAPABILITY_ID,
} from "../shared/capability"
import { parseNotificationReference } from "../../../synapse-capabilities/shared/message-reference"

/** Only the surface this capability needs, so a test double stays honest and small. */
export type AccountCapabilityService = {
  getState(): SynapseAccountState
  startLogin(): Promise<SynapseAccountLoginResult>
}

export type AccountCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context?: DispatchContext): Promise<DispatchResult>
}

type NotificationService = {
  listNotifications(input: { cursor?: string; filter?: "all" | "unread" | "pending" }): Promise<unknown>
  notificationUnreadCount(): Promise<unknown>
  getNotification(id: string): Promise<unknown>
  markNotificationRead(id: string): Promise<unknown>
  markAllNotificationsRead(): Promise<unknown>
  deleteNotification(id: string): Promise<unknown>
  deleteAllNotifications(filter: "all" | "pending"): Promise<unknown>
}

const idInput = z.object({ id: z.string().min(1) }).strict()
const getInput = z.object({ id: z.string().min(1).optional(), reference: z.string().optional() }).strict()
  .refine((input) => (input.id === undefined) !== (input.reference === undefined), "Provide exactly one notification locator.")
const emptyInput = z.object({}).strict()
const listInput = z.object({ filter: z.enum(["all", "unread", "pending"]).optional(), cursor: z.string().min(1).optional() }).strict()
const deleteAllInput = z.object({ filter: z.enum(["all", "pending"]) }).strict()

export function createAccountCapabilityDispatcher(deps: {
  readonly service: AccountCapabilityService
  readonly notifications?: NotificationService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}): AccountCapabilityDispatcher {
  return {
    async dispatch(action, params, context = {}) {
      if (action.startsWith("app.account.notification.")) {
        if (!deps.notifications) throw new Error("Notification capability is not configured.")
        const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
        const metadata = { action, source: context.source ?? "api", controllerInstanceId: context.controllerInstanceId }
        const permission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "network.connect", actor, resource: "synapse-notifications", context: metadata })
        if (permission && !permission.allowed) {
          deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-notifications", outcome: "denied", metadata })
          throw new Error(permission.reason)
        }
        try {
          let data: unknown
          switch (action) {
            case "app.account.notification.list": data = await deps.notifications.listNotifications(listInput.parse(params)); break
            case "app.account.notification.count": emptyInput.parse(params); data = await deps.notifications.notificationUnreadCount(); break
            case "app.account.notification.get": {
              const input = getInput.parse(params)
              data = await deps.notifications.getNotification(input.reference === undefined ? input.id! : parseNotificationReference(input.reference))
              break
            }
            case "app.account.notification.read": data = await deps.notifications.markNotificationRead(idInput.parse(params).id); break
            case "app.account.notification.read_all": emptyInput.parse(params); data = await deps.notifications.markAllNotificationsRead(); break
            case "app.account.notification.delete": data = await deps.notifications.deleteNotification(idInput.parse(params).id); break
            case "app.account.notification.delete_all": data = await deps.notifications.deleteAllNotifications(deleteAllInput.parse(params).filter); break
            default: throw new Error(`Unknown notification action: ${action}`)
          }
          deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-notifications", outcome: "allowed", metadata })
          return { ok: true, data }
        } catch (error) {
          deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-notifications", outcome: "failed", metadata: { ...metadata, errorName: error instanceof Error ? error.name : typeof error } })
          throw error
        }
      }
      switch (action) {
        case ACCOUNT_STATE_GET_CAPABILITY_ID:
          return { ok: true, data: deps.service.getState() }
        case ACCOUNT_LOGIN_START_CAPABILITY_ID: {
          // The whole result, not just the state: `outcome` is what tells a caller whether
          // it started anything, resumed something, or had nothing to do, and `loginUrl`
          // is what it can hand over when the browser did not open.
          const result = await deps.service.startLogin()
          if (result.outcome === "start_failed") {
            // Nothing was established, so there is nothing for a caller to poll or hand
            // over. An `open_failed` attempt is different and stays a success: the URL is
            // usable even though this process could not hand it to a browser.
            return { ok: false, code: "login_unavailable", error: "无法发起登录。", data: result }
          }
          const started = result.outcome === "opened" || result.outcome === "reused_attempt"
          return { ok: true, data: result, ...(started ? { affected: 1 } : {}) }
        }
        default:
          throw new Error(`Unknown account action: ${action}`)
      }
    },
  }
}
