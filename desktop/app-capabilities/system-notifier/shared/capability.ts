import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SYSTEM_NOTIFIER_APP_ID = "system-notifier" as const
export const SYSTEM_NOTIFIER_NAMESPACE = "system_notifier" as const
export const SYSTEM_NOTIFIER_SERVICE_ID = "core.system-notifier" as const
export const SYSTEM_NOTIFIER_SETTINGS_NAMESPACE = "app.system-notifier.settings" as const
export const SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID =
  "app.system_notifier.notification.trigger" as CapabilityId
export const SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME =
  "app_system_notifier_notification_trigger" as const
export const SYSTEM_NOTIFIER_WORKFLOW_NODE_TYPE =
  "system_notifier_notification_trigger" as const
export const SYSTEM_NOTIFIER_CAPABILITY_VERSION = "1.0.0" as const
