import { z, type ZodType } from "zod"

import type { McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import { TERMINAL_CAPABILITY_CATALOG } from "./capability"
import {
  terminalAcquireControlInputSchema,
  terminalCommandInputSchema,
  terminalCreateSessionOverrideInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteSessionInputSchema,
  terminalGroupCommandCreateInputSchema,
  terminalGroupCommandDeleteInputSchema,
  terminalGroupCommandLaunchInputSchema,
  terminalGroupCommandListInputSchema,
  terminalGroupCommandTargetSchema,
  terminalGroupCommandUpdateInputSchema,
  terminalGroupCreateInputSchema,
  terminalGroupDeleteCommitInputSchema,
  terminalGroupDeletePreviewInputSchema,
  terminalGroupDeleteInputSchema,
  terminalGroupLaunchUpdateInputSchema,
  terminalGroupListInputSchema,
  terminalGroupRenameInputSchema,
  terminalGroupTargetSchema,
  terminalGlobalLaunchGetInputSchema,
  terminalGlobalLaunchUpdateInputSchema,
  terminalLeaseOperationInputSchema,
  terminalObserveInputSchema,
  terminalOperationGetInputSchema,
  terminalPasteInputSchema,
  terminalRawInputSchema,
  terminalReadOutputInputSchema,
  terminalRenewControlInputSchema,
  terminalRequestBaseSchema,
  terminalResizeInputSchema,
  terminalSemanticInputSchema,
  terminalSessionListInputSchema,
  terminalSessionRenameInputSchema,
  terminalSessionStateListInputSchema,
  terminalSessionTargetSchema,
  terminalStopInputSchema,
  terminalViewInputSchema,
} from "./contract-schema"

const schemaByCapabilityId: Readonly<Record<string, ZodType>> = {
  "app.terminal.session.open": terminalSessionTargetSchema,
  "app.terminal.capabilities.get": terminalRequestBaseSchema,
  "app.terminal.diagnostics.get": terminalRequestBaseSchema,
  "app.terminal.global_launch.get": terminalGlobalLaunchGetInputSchema,
  "app.terminal.global_launch.update": terminalGlobalLaunchUpdateInputSchema,
  "app.terminal.group.list": terminalGroupListInputSchema,
  "app.terminal.group.get": terminalGroupTargetSchema,
  "app.terminal.group.create": terminalGroupCreateInputSchema,
  "app.terminal.group.rename": terminalGroupRenameInputSchema,
  "app.terminal.group.delete": terminalGroupDeleteInputSchema,
  "app.terminal.group_launch.get": terminalGroupTargetSchema,
  "app.terminal.group_launch.update": terminalGroupLaunchUpdateInputSchema,
  "app.terminal.group_delete.preview": terminalGroupDeletePreviewInputSchema,
  "app.terminal.group_delete.commit": terminalGroupDeleteCommitInputSchema,
  "app.terminal.group_command.list": terminalGroupCommandListInputSchema,
  "app.terminal.group_command.get": terminalGroupCommandTargetSchema,
  "app.terminal.group_command.create": terminalGroupCommandCreateInputSchema,
  "app.terminal.group_command.update": terminalGroupCommandUpdateInputSchema,
  "app.terminal.group_command.delete": terminalGroupCommandDeleteInputSchema,
  "app.terminal.group_command.launch": terminalGroupCommandLaunchInputSchema,
  "app.terminal.session.list": terminalSessionListInputSchema,
  "app.terminal.session_summary.get": terminalSessionTargetSchema,
  "app.terminal.session_state.list": terminalSessionStateListInputSchema,
  "app.terminal.session_state.get": terminalSessionTargetSchema,
  "app.terminal.session_metadata.get": terminalSessionTargetSchema,
  "app.terminal.session.create": terminalCreateSessionInputSchema,
  "app.terminal.session_override.create": terminalCreateSessionOverrideInputSchema,
  "app.terminal.session_metadata.rename": terminalSessionRenameInputSchema,
  "app.terminal.session.observe": terminalObserveInputSchema,
  "app.terminal.session_output.read": terminalReadOutputInputSchema,
  "app.terminal.session_output.observe": terminalObserveInputSchema.extend({
    limitBytes: z.number().int().positive().max(1024 * 1024),
  }).strict(),
  "app.terminal.session_view.get": terminalViewInputSchema,
  "app.terminal.session_control.acquire": terminalAcquireControlInputSchema,
  "app.terminal.session_control.renew": terminalRenewControlInputSchema,
  "app.terminal.session_control.release": terminalLeaseOperationInputSchema,
  "app.terminal.session_input.send": terminalSemanticInputSchema,
  "app.terminal.session_input.command": terminalCommandInputSchema,
  "app.terminal.session_input.paste": terminalPasteInputSchema,
  "app.terminal.session_input.raw": terminalRawInputSchema,
  "app.terminal.session.resize": terminalResizeInputSchema,
  "app.terminal.session.stop": terminalStopInputSchema,
  "app.terminal.session.force_stop": terminalStopInputSchema,
  "app.terminal.operation.get": terminalOperationGetInputSchema,
  "app.terminal.session.delete": terminalDeleteSessionInputSchema,
}

const toolNotes: Readonly<Record<string, string>> = {
  "app.terminal.session.open": "Pass an immutable sessionId already returned by another Terminal tool. This tool returns no terminal output.",
  "app.terminal.session_state.get": "`tty` is this session's PTY device: `ps -t <tty>` finds the process running inside it, which is how a pasted session reference is resolved to the Claude Code session occupying that terminal. `agent` reports that agent's own run state (`launching` never appears) with no prompt, answer, output, or tool-argument text. An absent `agent` means no agent ever ran here, or agent notifications are off — that is not the same as `state: \"ended\"`, which means one ran and has exited.",
  "app.terminal.session_state.list": "Same per-session shape as `app.terminal.session_state.get`, including each session's `tty` and its agent's run state.",
}

export function buildTerminalMcpTools(): McpToolDefinition[] {
  return TERMINAL_CAPABILITY_CATALOG.map((capability) => {
    const schema = schemaByCapabilityId[capability.id]
    if (!schema) throw new Error(`Missing Terminal MCP schema: ${capability.id}`)
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>
    delete jsonSchema.$schema
    const note = toolNotes[capability.id]
    return {
      name: capability.toolName,
      description: `${capability.description}${note ? ` ${note}` : ""} Permissions: ${capability.permissions.join(" + ") || "stable authentication"}; risk: ${capability.risk}; support is reported by app_terminal_capabilities_get.`,
      inputSchema: jsonSchema as McpToolDefinition["inputSchema"],
    }
  })
}

export function terminalInputSchemaForCapability(capabilityId: string): ZodType | undefined {
  return schemaByCapabilityId[capabilityId]
}
