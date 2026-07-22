import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const TEXT_EXTRACTOR_APP_ID = "text-extractor" as const
export const TEXT_EXTRACTOR_CAPABILITY_ID =
  "app.text_extractor.document.extract" as CapabilityId
export const TEXT_EXTRACTOR_MCP_TOOL_NAME =
  "app_text_extractor_document_extract" as const
export const TEXT_EXTRACT_WORKFLOW_NODE_TYPE = "text_extract" as const
