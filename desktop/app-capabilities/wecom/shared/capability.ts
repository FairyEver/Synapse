import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const WECOM_CONNECTOR_ID = "wecom" as const
export const WECOM_LEGACY_CONNECTOR_ID = "wecom-mail" as const
export const WECOM_CONNECTION_SERVICE_ID = "core.wecom" as const
export const WECOM_CONNECTION_STATE_NAMESPACE = "app.wecom.connection" as const
export const WECOM_LEGACY_STATE_NAMESPACE = "app.connectors.wecom-mail" as const

export const WECOM_MAIL_LIST_CAPABILITY_ID = "app.wecom.mail.list" as CapabilityId
export const WECOM_MAIL_GET_CAPABILITY_ID = "app.wecom.mail.get" as CapabilityId
export const WECOM_MAIL_SEND_CAPABILITY_ID = "app.wecom.mail.send" as CapabilityId

export const WECOM_MAIL_MCP_TOOL_NAMES = {
  list: "app_wecom_mail_list",
  get: "app_wecom_mail_get",
  send: "app_wecom_mail_send",
} as const

export const WECOM_MAIL_READ_PERMISSION = "搜索与获取邮件内容"
