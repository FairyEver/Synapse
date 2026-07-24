import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const CLIPBOARD_PACKAGE_ID = "clipboard" as const
export const CLIPBOARD_PACKAGE_VERSION = "1.0.0" as const
export const CLIPBOARD_SERVICE_ID = "core.clipboard" as const

export const CLIPBOARD_TEXT_WRITE_CAPABILITY_ID =
  "app.clipboard.text.write" as CapabilityId
export const CLIPBOARD_TEXT_READ_CAPABILITY_ID =
  "app.clipboard.text.read" as CapabilityId
export const CLIPBOARD_CAPABILITY_VERSION = "1.0.0" as const

export const CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE =
  "clipboard_text_write" as const
export const CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE =
  "clipboard_text_read" as const
