import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
const definitions = [
  ["list", "查询待办", "List only the signed-in user's todos by pending/all and literal case-insensitive title/note query. Pagination: offset-based. Continue with nextOffset until null; restart at 0 after changing filters. Changes can cause repeats or omissions."],
  ["get", "读取待办", "Read one owned Todo using exactly one id or complete synapse://todos/<id> reference. Does not open UI, mark notifications read or change completion."],
  ["create", "新增待办", "Create a cloud Todo authorized by the user. Title is required. Reminder is off by default; custom can have no due date. Resolve date, time and timezone ambiguity before invoking."],
  ["update", "修改待办", "Update an exactly identified owned Todo after reading its current version. Omitted fields keep values; null clears optional values. A 409 requires rereading, never silently overwriting."],
  ["set_completed", "完成或恢复待办", "Complete or restore one exactly identified Todo with its current version. Completion cancels pending reminders; restoring never resends a sent or past reminder."],
  ["delete", "删除待办", "Delete an exactly identified Todo authorized by the user, using its current version. No restore. Clarify ambiguous matches; a clear authorized deletion needs no extra formal confirmation."],
] as const
export const TODOS_DOMAIN: CapabilityDomainDefinition = { id: "todos", capabilities: definitions.map(([action, title, description]) => ({ id: `app.todos.item.${action}` as CapabilityId, title, description, mutates: action !== "list" && action !== "get" })) }
export const TODOS_MCP_TOOL_ACTIONS = Object.fromEntries(definitions.map(([action]) => [`app_todos_item_${action}`, `app.todos.item.${action}`]))
const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,200}$", description: "Owned immutable Todo ID." }
const date = { type: ["string", "null"], format: "date-time", description: "RFC3339 instant with explicit offset, seconds and milliseconds zero; server returns UTC. Null clears it." }
const fields = {
  title: { type: "string", minLength: 1, maxLength: 200, description: "Required nonblank title after trimming; maximum 200 Unicode code points." },
  note: { type: ["string", "null"], maxLength: 10000, description: "Optional plain text, maximum 10000 Unicode code points." },
  dueAt: date,
  reminder: { type: "string", enum: ["none", "at_due", "before_due", "custom"], description: "Relative reminders require dueAt. Newly set or changed reminder time must be in the future." },
  offsetMinutes: { type: ["integer", "null"], enum: [10, 60, 1440, null], description: "Only before_due uses an offset." },
  remindAt: { ...date, description: date.description + " Required for custom. Relative reminder time is computed by the server." },
}
const requestId = { type: "string", format: "uuid", description: "Stable UUID for retries of this exact operation and payload, valid for 24h. Reuse after a lost response; do not generate a new UUID for the retry." }
const preconditions = { expectedVersion: { type: "integer", minimum: 1, maximum: 2147483647, description: "Version from a fresh read; a reminder trigger also advances it." }, clientRequestId: requestId }
export function buildTodoTools(): McpToolDefinition[] {
  return definitions.map(([action, , description]) => {
    let properties: Record<string, unknown>, required: string[]
    switch (action) {
      case "list": properties = { filter: { type: "string", enum: ["pending", "all"], default: "pending" }, query: { type: "string", maxLength: 200, description: "Literal contains match; % and _ are ordinary characters." }, offset: { type: "integer", minimum: 0, maximum: 2147483647, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }; required = []; break
      case "get": properties = { id, reference: { type: "string", description: "Complete copied synapse://todos/<id> reference, passed unchanged. Supply this or id, exactly one." } }; required = []; break
      case "create": properties = { ...fields, clientRequestId: requestId }; required = ["title", "clientRequestId"]; break
      case "update": properties = { id, ...fields, ...preconditions }; required = ["id", "expectedVersion", "clientRequestId"]; break
      case "set_completed": properties = { id, completed: { type: "boolean" }, ...preconditions }; required = ["id", "completed", "expectedVersion", "clientRequestId"]; break
      case "delete": properties = { id, ...preconditions }; required = ["id", "expectedVersion", "clientRequestId"]; break
    }
    return { name: `app_todos_item_${action}`, description: description + " Permissions: network.connect; current account only.", inputSchema: { type: "object", properties, required, additionalProperties: false } }
  })
}
