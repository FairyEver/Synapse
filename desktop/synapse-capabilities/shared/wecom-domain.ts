import {
  WECOM_MAIL_GET_CAPABILITY_ID,
  WECOM_MAIL_LIST_CAPABILITY_ID,
  WECOM_MAIL_MCP_TOOL_NAMES,
  WECOM_MAIL_SEND_CAPABILITY_ID,
} from "../../app-capabilities/wecom/shared/capability"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

const definitions = [
  [
    WECOM_MAIL_MCP_TOOL_NAMES.list,
    WECOM_MAIL_LIST_CAPABILITY_ID,
    "Search or list mail in the inbox of the connected Enterprise WeChat mailbox. Requires the WeCom connector. Pagination: cursor-based. Continue with nextCursor; reset the cursor when the query changes.",
  ],
  [
    WECOM_MAIL_MCP_TOOL_NAMES.get,
    WECOM_MAIL_GET_CAPABILITY_ID,
    "Read one Enterprise WeChat mail by its internal mailId, including Markdown content and attachment names. Requires the WeCom connector and mail read permission.",
  ],
  [
    WECOM_MAIL_MCP_TOOL_NAMES.send,
    WECOM_MAIL_SEND_CAPABILITY_ID,
    "Send a new Enterprise WeChat mail, or reply when replyToMailId is present. Show the complete recipient, subject and body preview to the user first, then set confirmed=true only when the user has authorized sending and no unresolved review request remains.",
  ],
] as const

export const WECOM_DOMAIN: CapabilityDomainDefinition = {
  id: "wecom",
  capabilities: definitions.map(([, id, description]) => ({
    id,
    title: description,
    description,
    mutates: id === WECOM_MAIL_SEND_CAPABILITY_ID,
  })),
}

export const WECOM_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  definitions.map(([name, id]) => [name, id]),
)

const text = (description: string) => ({ type: "string", description })
const emails = (description: string) => ({
  type: "array",
  items: { type: "string", format: "email" },
  minItems: 1,
  maxItems: 100,
  description,
})

const schemas: Record<string, { properties: Record<string, unknown>; required?: readonly string[] }> = {
  [WECOM_MAIL_MCP_TOOL_NAMES.list]: {
    properties: {
      query: text("Optional search words matched against subject and body."),
      cursor: text("Opaque nextCursor returned by the previous page."),
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size, default 50." },
    },
  },
  [WECOM_MAIL_MCP_TOOL_NAMES.get]: {
    properties: {
      mailId: text("Internal mailId returned by app_wecom_mail_list."),
    },
    required: ["mailId"],
  },
  [WECOM_MAIL_MCP_TOOL_NAMES.send]: {
    properties: {
      to: emails("Primary recipient email addresses."),
      cc: { ...emails("Cc email addresses."), minItems: 0 },
      bcc: { ...emails("Bcc email addresses."), minItems: 0 },
      subject: text("Mail subject."),
      body: text("Complete Markdown mail body."),
      replyToMailId: text("Source mailId when replying; omit for a new mail."),
      replyAll: { type: "boolean", description: "Reply to all recipients when replyToMailId is present." },
      confirmed: {
        type: "boolean",
        enum: [true],
        description: "Set true only after showing the full preview and confirming the user authorized this exact send.",
      },
    },
    required: ["to", "subject", "body", "confirmed"],
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
