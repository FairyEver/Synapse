import { shareMessagesInputSchema, shareGenerateInputSchema, shareOutputInputSchema } from "./share"
import { z, type ZodType } from "zod"

import type { McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import { AGENT_CONVERSATION_CAPABILITY_CATALOG } from "./capability"
import {
  agentGroupListInputSchema,
  agentProviderListInputSchema,
  agentConversationCreateInputSchema,
  agentConversationInspectInputSchema,
  agentConversationObserveInputSchema,
  agentConversationOpenInputSchema,
  agentMessageSendInputSchema,
  agentPermissionRespondInputSchema,
  agentTurnSteerInputSchema,
  agentTurnStopInputSchema,
} from "./schema"

const inputSchemas: Readonly<Record<string, ZodType>> = {
  "app.agent.share.messages": shareMessagesInputSchema,
  "app.agent.share.generate": shareGenerateInputSchema,
  "app.agent.share.output": shareOutputInputSchema,
  "app.agent.group.list": agentGroupListInputSchema,
  "app.agent.provider.list": agentProviderListInputSchema,
  "app.agent.conversation.create": agentConversationCreateInputSchema,
  "app.agent.conversation.open": agentConversationOpenInputSchema,
  "app.agent.conversation.inspect": agentConversationInspectInputSchema,
  "app.agent.conversation.observe": agentConversationObserveInputSchema,
  "app.agent.message.send": agentMessageSendInputSchema,
  "app.agent.turn.steer": agentTurnSteerInputSchema,
  "app.agent.turn.stop": agentTurnStopInputSchema,
  "app.agent.turn.force_stop": agentTurnStopInputSchema,
  "app.agent.permission.respond": agentPermissionRespondInputSchema,
}

const TARGET_NOTE = "Provide exactly one target: the complete unchanged deepLink, projectId with conversationRef, or the legacy projectId with conversationId. Never mix target forms."

const toolNotes: Readonly<Record<string, string>> = {
  "app.agent.share.messages": "Use shareContextRef supplied by the host for THIS user turn. Never invent references or use the focused window. Returns bounded excerpts, not full export text. Query matches literal message text. Pagination: offset-based. Continue with nextOffset until null. Resolve ambiguous selections with the user.",
  "app.agent.share.generate": "Use the current host shareContextRef. latest_turn selects the preceding complete question and final reply; all selects all prior visible messages; assistant selects only the preceding final reply. For specific or non-contiguous messages, first list messages and pass messageRefs with selection=messages. Never rewrite source text. Default result appears in the conversation. Reuse idempotencyKey for unchanged retries. Limits fail explicitly without cropping, downscaling or splitting. Pass returned shareImageRef to app_agent_share_output, app_mail_internal_attachment_create or app_mail_attachment_import_local as requested. No upload or sending occurs here.",
  "app.agent.share.output": "Provide the exact shareImageRef from generate. copy writes an image, not text. save with an absolute .png outputPath saves without a dialog and refuses overwrite; omission opens the source window save dialog. Report cancelled or failed output honestly; the generated image remains available.",
  "app.agent.provider.list": "Use returned providerId and models[].modelTier together in app_agent_conversation_create. Query matches provider or model names; each provider includes all selectable configured tiers. Page with nextOffset. Ambiguous model/provider names require user clarification. Local Claude Code default may have modelName null; displayName identifies it without inventing a model name.",
  "app.agent.group.list": "Use returned projectId to create in a named group. A group is a project, not a conversation source filter or the archived section. Continue with nextOffset when present.",
  "app.agent.conversation.create": "For a requested model, discover it with app_agent_provider_list and pass both providerId and modelTier. Unavailable explicit selections fail without fallback. Omit both to use UI quick-create defaults. Omit all group selectors to use 本地对话. Otherwise provide exactly one of projectId, an exact projectName, or sameGroupAs (an existing conversation target, with the user's complete unchanged deepLink for first use). Ambiguous names fail; list groups and ask the user to choose. Reuse the same idempotencyKey when retrying an unchanged request. This creates an empty conversation without opening it or sending a message; use app_agent_message_send with the returned reference when requested. Missing or unavailable groups never fall back to 本地对话. No history, persona, or model is copied from sameGroupAs.",
  "app.agent.conversation.open": "For a user-supplied link, pass the complete deepLink unchanged so Synapse parses it deterministically. This tool returns no conversation content.",
  "app.agent.conversation.inspect": "For the first read, pass the complete deepLink unchanged. Use the returned conversationRef for follow-up calls and timeline.nextBeforeIndex as beforeIndex to read older pages. Conversations transferred to Claude Code remain readable with controllable=false; CLI messages are not imported. Pages may split user turns; associate tool calls and results across pages by toolUseId. Results are redacted and bounded to 100 timeline entries, 64 KiB per entry, and 1 MiB per page.",
  "app.agent.conversation.observe": "Use projectId and conversationRef returned by inspect with the prior revision. It waits at most 30 seconds and never returns timeline bodies.",
  "app.agent.message.send": "Use projectId and conversationRef returned by inspect. Only user-owned local conversations are controllable. Conversations transferred to Claude Code are read-only and reject sends with control_not_supported. Acceptance is asynchronous; observe the returned turnId before claiming completion.",
  "app.agent.turn.steer": "Use only when the user explicitly wants to adjust the exact currently running turn. Slash commands are rejected.",
  "app.agent.turn.stop": "Use the exact active turnId from inspect or observe. This never escalates automatically to force stop.",
  "app.agent.turn.force_stop": "Use only after the user explicitly requests forced termination of the exact active turn.",
  "app.agent.permission.respond": "For tool permissions, expectedToolName is required and allow requires explicit user authorization for that exact request. For user questions, pass every answer by questionIndex or use skip.",
}

export function buildAgentConversationMcpTools(): McpToolDefinition[] {
  return AGENT_CONVERSATION_CAPABILITY_CATALOG.map((metadata) => {
    const schema = inputSchemas[metadata.id]
    if (!schema) throw new Error(`Missing Agent conversation MCP schema: ${metadata.id}`)
    const inputSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>
    delete inputSchema.$schema
    return {
      name: metadata.toolName,
      description: `${metadata.description} ${metadata.id.startsWith("app.agent.share.") || metadata.id === "app.agent.group.list" || metadata.id === "app.agent.provider.list" || metadata.id === "app.agent.conversation.create" ? "" : TARGET_NOTE} ${toolNotes[metadata.id] ?? ""}`.trim(),
      inputSchema: inputSchema as McpToolDefinition["inputSchema"],
    }
  })
}

export function agentConversationInputSchemaForCapability(id: string): ZodType | undefined {
  return inputSchemas[id]
}
