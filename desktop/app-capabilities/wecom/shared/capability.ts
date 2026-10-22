import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const WECOM_CONNECTOR_ID = "wecom" as const
export const WECOM_LEGACY_CONNECTOR_ID = "wecom-mail" as const
export const WECOM_CONNECTION_SERVICE_ID = "core.wecom" as const
export const WECOM_CONNECTION_STATE_NAMESPACE = "app.wecom.connection" as const
export const WECOM_LEGACY_STATE_NAMESPACE = "app.connectors.wecom-mail" as const

export const WECOM_CONNECTION_GET_CAPABILITY_ID = "app.wecom.connection.get" as CapabilityId
export const WECOM_CLI_RUN_CAPABILITY_ID = "app.wecom.cli.run" as CapabilityId

export const WECOM_MCP_TOOL_NAMES = {
  connectionGet: "app_wecom_connection_get",
  cliRun: "app_wecom_cli_run",
} as const
