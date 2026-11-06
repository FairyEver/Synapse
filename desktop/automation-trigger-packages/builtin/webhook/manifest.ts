import { commonTriggerVariables } from "../common-variables"
import type { AutomationTriggerManifest } from "../../types.shared"
import {
  type WebhookTriggerConfig,
  webhookTriggerConfigSchema,
} from "./schema"

const webhookTriggerVariables = [
  ...commonTriggerVariables(false).map(variable => variable.key === "trigger.triggeredAt" ? { ...variable, aliases: ["trigger.scheduledAt", "trigger.payload.request.receivedAt"] } : variable),
  { key: "trigger.receivedAt", label: "本机接收时间", group: "trigger", description: "本机收到事件的时间，网络延迟时晚于来源触发时间。" },
  { key: "trigger.source", label: "事件来源", group: "event", example: "webhook" },
  { key: "trigger.eventType", label: "事件类型", group: "event", example: "webhook.delivery.received" },
  { key: "trigger.payload", label: "完整 Webhook", group: "event", description: "包含请求和投递信息的 JSON，不含未脱敏凭据。" },
  { key: "trigger.deliveryId", label: "投递 ID", group: "event" },
  { key: "trigger.webhook.id", label: "Webhook ID", group: "event", aliases: ["trigger.payload.webhook.id"], description: "Webhook 配置的内部稳定标识。" },
  { key: "trigger.webhook.publicId", label: "Webhook 公开标识", group: "event", aliases: ["trigger.payload.webhook.publicId"], description: "用于选择当前 Webhook 的公开标识。" },
  { key: "trigger.webhook.name", label: "Webhook 名称", group: "event", aliases: ["trigger.payload.webhook.name"] },
  { key: "trigger.request.method", aliases: ["trigger.payload.request.method"], label: "请求方法", group: "event" },
  { key: "trigger.request.contentType", aliases: ["trigger.payload.request.contentType"], label: "Content-Type", group: "event" },
  { key: "trigger.request.remoteAddress", label: "请求来源地址", group: "event", aliases: ["trigger.payload.request.remoteAddress"], description: "请求来源的 IP；来源未提供时为空。" },
  { key: "trigger.request.bodyText", aliases: ["trigger.payload.request.bodyText"], label: "请求文本", group: "event" },
  { key: "trigger.request.body", label: "请求 Body", group: "event", dynamic: true, aliases: ["trigger.payload.request.body"], description: "解析后的请求内容；对象和数组输出 JSON。", example: '{"order":{"id":"ORDER-1"}}' },
  { key: "trigger.request.query", label: "Query 参数", group: "event", dynamic: true, aliases: ["trigger.payload.request.query"], description: "URL 查询参数；可选择具体字段。", example: '{"source":"erp"}' },
  { key: "trigger.request.headers", label: "请求 Header", group: "event", dynamic: true, aliases: ["trigger.payload.request.headers"], description: "键名为小写；敏感字段已脱敏。", example: '{"content-type":"application/json"}' },
] as const

export const webhookTriggerManifest = {
  id: "builtin.webhook",
  title: "Webhook",
  kind: "event",
  defaultConfig: {
    webhookPublicId: "",
  },
  configSchema: webhookTriggerConfigSchema,
  variables: webhookTriggerVariables,
} satisfies AutomationTriggerManifest<WebhookTriggerConfig>
