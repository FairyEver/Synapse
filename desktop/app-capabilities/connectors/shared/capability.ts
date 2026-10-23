import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const CONNECTORS_APP_ID = "connectors" as const
export const CONNECTORS_NAMESPACE = "connectors" as const
export const CONNECTORS_ITEMS_NAMESPACE = "app.connectors.items" as const
export const CONNECTORS_CREDENTIALS_NAMESPACE = "app.connectors.credentials" as const
export const CONNECTORS_STATE_NAMESPACE = "app.connectors.state" as const

export const CONNECTORS_ITEM_LIST_CAPABILITY_ID = "app.connectors.item.list" as CapabilityId
export const CONNECTORS_ITEM_CONNECT_CAPABILITY_ID = "app.connectors.item.connect" as CapabilityId
export const CONNECTORS_ITEM_DISCONNECT_CAPABILITY_ID = "app.connectors.item.disconnect" as CapabilityId

export const PORTAL_LINK_CREDENTIAL_CAPABILITY_ID = "app.connectors.portal_link.credential.get" as const
export const PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID = "app.connectors.portal_link_test.credential.get" as const
export const PORTAL_CREDENTIAL_CAPABILITY_IDS = [PORTAL_LINK_CREDENTIAL_CAPABILITY_ID, PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID] as const
