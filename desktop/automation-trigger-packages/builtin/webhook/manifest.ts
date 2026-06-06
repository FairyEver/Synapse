import type { AutomationTriggerManifest } from "../../types.shared"
import {
  type WebhookTriggerConfig,
  webhookTriggerConfigSchema,
} from "./schema"

const webhookTriggerVariables = [
  { key: "trigger.type", label: "触发器类型", group: "trigger" },
  { key: "trigger.triggeredBy", label: "运行来源", group: "trigger" },
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.scheduledAt", label: "计划时间", group: "trigger" },
  { key: "trigger.automationId", label: "自动化 ID", group: "trigger" },
  { key: "trigger.automationName", label: "自动化名称", group: "trigger" },
  { key: "trigger.source", label: "事件来源", group: "event" },
  { key: "trigger.eventType", label: "事件类型", group: "event" },
  { key: "trigger.receivedAt", label: "接收时间", group: "event" },
  { key: "trigger.deliveryId", label: "投递 ID", group: "event" },
  { key: "trigger.webhook.id", label: "Webhook ID", group: "event" },
  { key: "trigger.webhook.publicId", label: "Webhook Public ID", group: "event" },
  { key: "trigger.webhook.name", label: "Webhook 名称", group: "event" },
  { key: "trigger.request.method", label: "请求方法", group: "event" },
  { key: "trigger.request.contentType", label: "Content-Type", group: "event" },
  { key: "trigger.request.bodyText", label: "请求文本", group: "event" },
  { key: "trigger.request.body", label: "请求 Body", group: "event", dynamic: true },
  { key: "trigger.request.query", label: "Query 参数", group: "event", dynamic: true },
  { key: "trigger.request.headers", label: "请求 Header", group: "event", dynamic: true },
  { key: "trigger.payload.request.body", label: "原始 Body 变量", group: "event", dynamic: true },
  { key: "trigger.payload.request.query", label: "原始 Query 变量", group: "event", dynamic: true },
  { key: "trigger.payload.request.headers", label: "原始 Header 变量", group: "event", dynamic: true },
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
