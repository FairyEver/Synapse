import type { AutomationTriggerVariableDescriptor } from "../types.shared"

export function commonTriggerVariables(schedule: boolean): AutomationTriggerVariableDescriptor[] {
  return [
    { key: "trigger.automationName", label: "自动化名称", group: "trigger", example: "每日汇总" },
    { key: "trigger.automationId", label: "自动化 ID", group: "trigger", description: "当前自动化的稳定标识。" },
    { key: "trigger.runId", label: "本次运行 ID", group: "trigger", description: "用于关联本次运行记录和产物。" },
    { key: "trigger.triggeredAt", label: "触发时间", group: "trigger", description: schedule ? "调度触发的时间，ISO UTC。" : "来源事件发生的时间，ISO UTC。", example: "2026-11-06T01:00:00.000Z" },
    ...(schedule ? [{ key: "trigger.scheduledAt", label: "计划时间", group: "trigger" as const, description: "原计划执行的时间；补跑时仍保留原计划，ISO UTC。" }] : []),
    { key: "trigger.executedAt", label: "实际执行时间", group: "trigger", description: "本次运行实际开始的时间，ISO UTC。" },
    { key: "trigger.date", label: "业务日期", group: "trigger", description: schedule ? "按有效时区计算的计划日期；补跑保留计划日期，手动运行取执行日期。" : "按有效时区计算的事件日期。", example: "2026-11-06" },
    { key: "trigger.timezone", label: "有效时区", group: "config", description: "Cron 使用指定时区，未指定及其他触发器使用系统时区。", example: "Asia/Shanghai" },
    { key: "trigger.triggeredBy", label: "运行来源", group: "config", description: "trigger 自动触发；manual 手动运行；missed_run 错过后的补跑。" },
    { key: "trigger.type", label: "触发器类型", group: "config", example: "builtin.cron" },
  ]
}
