import {
  channelZod as z,
  channelCreateSchema,
  channelEventNameSchema,
  channelPublishHttpSchema,
  channelTokenCreateSchema,
  channelUpdateSchema,
} from "@synapse/shared/channel-contracts"
import type { CapabilityDomainDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"

const channelPath = "/:channelId"
const tokensPath = "/:channelId/tokens"
const tokenPath = "/:channelId/tokens/:tokenId"
const pathId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u)
const eventPathParam = channelEventNameSchema.refine(
  (value) => value !== "." && value !== ".." && !value.includes(".."),
  "事件名不能包含路径穿越段。",
)

type OperationOptions = {
  body?: z.ZodObject<z.ZodRawShape>
  mutates?: boolean
}

function operation(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  title: string,
  description: string,
  options: OperationOptions = {},
) {
  const baseShape: Record<string, z.ZodTypeAny> = {
    ...(options.body?.shape ?? {}),
    ...(path.includes(":channelId") ? { channelId: pathId.describe("Channel ID from channel list or create result.") } : {}),
    ...(path.includes(":tokenId") ? { tokenId: pathId.describe("Channel token ID from token list or create result.") } : {}),
    ...(path.includes(":event") ? { event: eventPathParam.describe("Exact retained event name to clear silently.") } : {}),
  }
  let input: z.ZodTypeAny = z.strictObject(baseShape)
  if (options.body === channelUpdateSchema) {
    input = input.refine(
      (value) => {
        const record = value as { name?: unknown; description?: unknown }
        return record.name !== undefined || record.description !== undefined
      },
      "至少提供一个待更新字段。",
    )
  }
  if (options.body === channelPublishHttpSchema) {
    input = input.superRefine((value, ctx) => {
      const record = value as { retain?: boolean; targetClientId?: string }
      if (record.retain && record.targetClientId) {
        ctx.addIssue({
          code: "custom",
          path: ["retain"],
          message: "定向投递事件不允许同时启用 retain。",
        })
      }
    })
  }
  return { method, path, title, description, input, ...options }
}

export const channelOperations = {
  "app.channels.publish_preflight.get": operation(
    "GET",
    "/publish-preflight",
    "频道发布前检查",
    "Before creating a channel or publishing connected webpages (频道、大屏+手机遥控器、网页实时控制后端), check the signed-in account, configured public base URL, audience (local_only, public, or environment_mismatch), and channel capabilities. Does not create or mutate resources.",
  ),
  "app.channels.channel.list": operation(
    "GET",
    "",
    "列出频道",
    "List all realtime signaling channels (频道) owned by the signed-in user with onlineCount and tokenCount.",
  ),
  "app.channels.channel.get": operation(
    "GET",
    channelPath,
    "读取频道详情",
    "Read a single owned channel's metadata, onlineCount, and tokenCount.",
  ),
  "app.channels.channel.create": operation(
    "POST",
    "",
    "创建频道",
    "Create a new realtime signaling channel (新建频道) for browser-to-backend or multi-webpage coordination. Returns channel id.",
    { body: channelCreateSchema, mutates: true },
  ),
  "app.channels.channel.update": operation(
    "PATCH",
    channelPath,
    "修改频道信息",
    "Update an owned channel's display name or description.",
    { body: channelUpdateSchema, mutates: true },
  ),
  "app.channels.channel.delete": operation(
    "DELETE",
    channelPath,
    "删除频道",
    "Permanently delete an owned channel, disconnect all live WebSocket clients (4003), and destroy its tokens and retained snapshots.",
    { mutates: true },
  ),
  "app.channels.token.list": operation(
    "GET",
    tokensPath,
    "列出频道凭证",
    "List active role-scoped channel tokens (prefix, role, lastUsedAt) for an owned channel. Never returns plaintext secrets.",
  ),
  "app.channels.token.create": operation(
    "POST",
    tokensPath,
    "签发频道凭证",
    "Issue a role-scoped channel token (subscribe, publish, or pubsub; max 20 active per channel). Returns plaintext syc_ secret only once.",
    { body: channelTokenCreateSchema, mutates: true },
  ),
  "app.channels.token.revoke": operation(
    "DELETE",
    tokenPath,
    "撤销频道凭证",
    "Revoke a channel token and immediately disconnect all live WebSocket connections authenticated with that token (4003).",
    { mutates: true },
  ),
  "app.channels.event.publish": operation(
    "POST",
    channelPath + "/events",
    "发布频道事件",
    "Publish a realtime event into an owned channel. Broadcasts by default, or delivers live-only to targetClientId (cannot combine with retain=true).",
    { body: channelPublishHttpSchema, mutates: true },
  ),
  "app.channels.state.get": operation(
    "GET",
    channelPath + "/state",
    "读取频道实时状态",
    "Read a channel's current latestSeq, live non-observer presence members, and persisted Retain snapshots.",
  ),
  "app.channels.retained.clear": operation(
    "DELETE",
    channelPath + "/retained/:event",
    "清除频道保留状态",
    "Silently delete a persisted Retain snapshot for an exact event name without broadcasting a live event.",
    { mutates: true },
  ),
} as const

export type ChannelAction = keyof typeof channelOperations

export function isChannelAction(action: string): action is ChannelAction {
  return Object.hasOwn(channelOperations, action)
}

const actions = Object.keys(channelOperations) as ChannelAction[]
const toolName = (action: ChannelAction) => action.replaceAll(".", "_")

export const CHANNELS_DOMAIN: CapabilityDomainDefinition = {
  id: "channels",
  capabilities: actions.map((id) => {
    const { title, description, mutates } = channelOperations[id]
    return { id, title, description, mutates: Boolean(mutates) }
  }),
}

export const CHANNELS_MCP_TOOL_ACTIONS = Object.fromEntries(actions.map((action) => [toolName(action), action]))

export function buildChannelTools(): McpToolDefinition[] {
  return actions.map((action) => {
    const { description, input } = channelOperations[action]
    const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: "input" })
    if (!schema.properties) throw new Error("Channel discovery requires object input")
    return {
      name: toolName(action),
      description: description + " Permissions: network.connect; signed-in desktop account and channel ownership.",
      inputSchema: { ...schema, type: "object", properties: schema.properties, additionalProperties: false },
    }
  })
}
