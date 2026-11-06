import { commonTriggerVariables } from "./common-variables"
import type { AutomationTriggerVariableDescriptor } from "../types.shared"

export function mailTriggerVariables(external: boolean): AutomationTriggerVariableDescriptor[] {
  const common = [
    ["id", external ? "邮件ID" : "站内信ID"],
    ["subject", "主题"], ["body", "正文"], ["sender", "发件人"], ["to", "收件人"], ["cc", "抄送人"],
    ["receivedAt", "收信时间"], ["attachmentCount", "附件数量"], ["attachments", "附件信息"],
  ]
  common.push(["sentAt", "发送时间"])
  if (external) common.push(["senderAddresses", "发件邮箱"], ["replyToAddresses", "回复邮箱"])
  else common.push(["senderId", "发件人标识"], ["senderKind", "发件人类型"])
  if (external) common.push(["accountId", "邮箱账号 ID"], ["accountName", "邮箱账号名称"], ["accountAddress", "邮箱地址"])
  return [
    ...commonTriggerVariables(false),
    { key: "trigger.receivedAt", label: "本机接收时间", group: "trigger", description: "本机发现并入队的时间，离线补收时与来源时间不同。" },
    ...common.map(([key, label]) => ({ key: `trigger.payload.${key}`, label: label!, group: "event" as const,
      ...(key === "id" ? { aliases: ["trigger.payload.url"], example: external ? "synapse://mail/em_…" : "synapse://mail-internal/…" } : {}),
      ...(key === "attachments" ? { description: "附件定位信息的 JSON，包含 attachmentId；外部邮件另含 assetId。" } : {}),
      ...(key === "senderAddresses" || key === "replyToAddresses" ? { description: "邮箱地址数组的 JSON；回复邮箱优先 Reply-To，无有效地址时使用 From。", example: '["person@example.com"]' } : {}),
      ...(key === "senderKind" ? { description: "user 用户；system 平台公告，公告没有可回复的发件人标识。" } : {}),
      ...(key === "sentAt" ? { description: "来源发送时间，ISO UTC；外部邮件无法确认时为空。" } : {}),
      ...(key === "receivedAt" ? { description: external ? "邮件服务器收件时间 INTERNALDATE，ISO UTC。" : "站内信发送事务时间，ISO UTC；当前未提供独立投递时间。" } : {}),
    })),
  ]
}
