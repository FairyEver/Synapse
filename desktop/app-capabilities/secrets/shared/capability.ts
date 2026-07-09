import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SECRETS_APP_ID = "secrets" as const
export const SECRETS_NAMESPACE = "secrets" as const
export const SECRETS_ITEMS_NAMESPACE = "app.secrets.items" as const
export const SECRETS_SETTINGS_NAMESPACE = "app.secrets.settings" as const

export const SECRETS_ITEM_LIST_CAPABILITY_ID = "app.secrets.item.list" as CapabilityId
export const SECRETS_ITEM_GET_CAPABILITY_ID = "app.secrets.item.get" as CapabilityId
export const SECRETS_ITEM_CREATE_CAPABILITY_ID = "app.secrets.item.create" as CapabilityId
export const SECRETS_ITEM_UPDATE_CAPABILITY_ID = "app.secrets.item.update" as CapabilityId
export const SECRETS_ITEM_UPSERT_CAPABILITY_ID = "app.secrets.item.upsert" as CapabilityId
export const SECRETS_ITEM_DELETE_CAPABILITY_ID = "app.secrets.item.delete" as CapabilityId

export const SECRETS_CAPABILITY_IDS = [
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
] as const

export const SECRETS_MCP_TOOL_NAMES = {
  list: "app_secrets_item_list",
  get: "app_secrets_item_get",
  create: "app_secrets_item_create",
  update: "app_secrets_item_update",
  upsert: "app_secrets_item_upsert",
  delete: "app_secrets_item_delete",
} as const
