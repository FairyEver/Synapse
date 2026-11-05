import type { AutomationTriggerVariableDescriptor } from "../types.shared"

export function mailTriggerVariables(external: boolean): AutomationTriggerVariableDescriptor[] {
  const common = [
    ["id", external ? "邮件ID" : "站内信ID"],
    ["messageId", "信件 ID"], ["subject", "主题"], ["body", "正文"], ["sender", "发件人"], ["to", "收件人"], ["cc", "抄送人"],
    ["receivedAt", "收信时间"], ["attachmentCount", "附件数量"], ["attachments", "附件信息"], ["url", "信件链接"],
  ]
  if (external) common.push(["accountId", "邮箱账号 ID"], ["accountName", "邮箱账号名称"], ["accountAddress", "邮箱地址"])
  return [
    ...[["type", "触发器类型"], ["triggeredBy", "运行来源"], ["triggeredAt", "触发时间"], ["automationId", "自动化 ID"], ["automationName", "自动化名称"]].map(([key, label]) => ({ key: `trigger.${key}`, label: label!, group: "trigger" as const })),
    ...common.map(([key, label]) => ({ key: `trigger.payload.${key}`, label: label!, group: "event" as const })),
  ]
}
