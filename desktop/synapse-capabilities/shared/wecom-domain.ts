import {
  WECOM_CLI_RUN_CAPABILITY_ID,
  WECOM_CONNECTION_GET_CAPABILITY_ID,
  WECOM_MCP_TOOL_NAMES,
} from "../../app-capabilities/wecom/shared/capability"
import { WECOM_CLI_SERVICES } from "../../app-capabilities/wecom/shared/command-schema"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

const definitions = [
  [
    WECOM_MCP_TOOL_NAMES.connectionGet,
    WECOM_CONNECTION_GET_CAPABILITY_ID,
    "Check whether the Enterprise WeChat connector is connected and return its connection and last-validation times. Use for 企业微信连接状态、授权状态、是否已连接. This tool never returns credentials or bot identifiers.",
  ],
  [
    WECOM_MCP_TOOL_NAMES.cliRun,
    WECOM_CLI_RUN_CAPABILITY_ID,
    "Run one approved Enterprise WeChat messaging command through the connected bot. Use for 企业微信消息、企微单聊群聊、最近会话、发送文本图片文件语音视频. Supports message commands, media upload for message attachments, identity and schema operations. Pass the canonical arguments from the Synapse WeCom messaging Skill without the `wecom-cli` executable name. Never pass auth commands or credentials.",
  ],
] as const

export const WECOM_DOMAIN: CapabilityDomainDefinition = {
  id: "wecom",
  capabilities: definitions.map(([, id, description]) => ({
    id,
    title: description,
    description,
    mutates: id === WECOM_CLI_RUN_CAPABILITY_ID,
    ...(id === WECOM_CLI_RUN_CAPABILITY_ID ? { risk: "high" as const } : {}),
  })),
}

export const WECOM_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  definitions.map(([name, id]) => [name, id]),
)

const schemas: Record<string, { properties: Record<string, unknown>; required?: readonly string[] }> = {
  [WECOM_MCP_TOOL_NAMES.connectionGet]: {
    properties: {},
  },
  [WECOM_MCP_TOOL_NAMES.cliRun]: {
    properties: {
      args: {
        type: "array",
        items: {
          type: "string",
          maxLength: 64 * 1024,
        },
        minItems: 1,
        maxItems: 256,
        description: `Canonical Enterprise WeChat CLI arguments without the executable name. The first argument must be one of: ${WECOM_CLI_SERVICES.join(", ")}. For media, only upload is supported as a messaging dependency.`,
      },
    },
    required: ["args"],
  },
}

export function buildWecomTools(): McpToolDefinition[] {
  return definitions.map(([name, , description]) => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: schemas[name]!.properties,
      required: schemas[name]!.required,
      additionalProperties: false,
    },
  }))
}
