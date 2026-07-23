import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const HTML_GENERATOR_APP_ID = "html-generator" as const
export const HTML_GENERATOR_EJS_CAPABILITY_ID = "app.html_generator.ejs.generate" as CapabilityId
export const HTML_GENERATOR_EJS_FILE_CAPABILITY_ID = "app.html_generator.ejs_file.generate" as CapabilityId
export const HTML_GENERATOR_EJS_MCP_TOOL_NAME = "app_html_generator_ejs_generate" as const
export const HTML_GENERATOR_EJS_FILE_MCP_TOOL_NAME = "app_html_generator_ejs_file_generate" as const
export const HTML_GENERATOR_EJS_WORKFLOW_NODE_TYPE = "html_generator_ejs_generate" as const
export const HTML_GENERATOR_EJS_FILE_WORKFLOW_NODE_TYPE = "html_generator_ejs_file_generate" as const
export const HTML_GENERATOR_SERVICE_ID = "core.html-generator" as const
export const HTML_GENERATOR_FILE_SERVICE_ID = "core.html-generator-file" as const

export const HTML_GENERATOR_CAPABILITY_IDS = [
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
] as const

export const HTML_GENERATOR_MCP_TOOL_NAMES = [
  HTML_GENERATOR_EJS_MCP_TOOL_NAME,
  HTML_GENERATOR_EJS_FILE_MCP_TOOL_NAME,
] as const

export const HTML_GENERATOR_WORKFLOW_NODE_TYPES = [
  HTML_GENERATOR_EJS_WORKFLOW_NODE_TYPE,
  HTML_GENERATOR_EJS_FILE_WORKFLOW_NODE_TYPE,
] as const
