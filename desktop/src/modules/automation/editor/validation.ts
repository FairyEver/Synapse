import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { automationConditionsSchema } from "../../../../automation-trigger-packages/schedule-constraints"
import type { AutomationEditorDraft } from "../types"

export type AutomationFieldErrors = Readonly<Record<string, string>>
const messages: Record<string, string> = { mode: "请选择权限模式", sessionPolicy: "请选择会话策略", projectId: "请选择项目", providerId: "请选择供应商和模型", modelTier: "请选择模型", prompt: "请填写提示词", expr: "请填写有效的 Cron 表达式", timezone: "请填写有效时区", everyMinutes: "请输入大于 0 的间隔分钟", webhookPublicId: "请选择 Webhook", timeoutMins: "请检查超时分钟" }

export function validateAutomationDraftFields(draft: AutomationEditorDraft): AutomationFieldErrors {
  const errors: Record<string, string> = {}
  if (!draft.name.trim()) errors.name = "请填写自动化名称"
  function check(scope: string, operation: () => unknown) {
    try { operation() } catch (cause) {
      const issues = (cause as { issues?: { path: PropertyKey[]; message: string }[] })?.issues
      if (issues?.length) for (const issue of issues) {
        const key = String(issue.path[0] ?? "config")
        errors[`${scope}.${key}`] = messages[key] ?? issue.message
      }
      else errors[`${scope}.${scope === "trigger" ? "expr" : "config"}`] = cause instanceof Error ? cause.message : "请检查配置"
    }
  }
  if (!draft.triggerType) errors["trigger.type"] = "请选择触发条件"
  else check("trigger", () => rendererAutomationTriggerRegistry.parseConfig(draft.triggerType!, draft.triggerConfig))
  if (draft.triggerType === "builtin.cron" && typeof draft.triggerConfig.timezone === "string" && draft.triggerConfig.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: draft.triggerConfig.timezone }).format(new Date()) } catch { errors["trigger.timezone"] = messages.timezone! }
  }
  if (draft.conditions) check("conditions", () => automationConditionsSchema.parse(draft.conditions))
  if (!draft.executorType) errors["executor.type"] = "请选择执行操作"
  else check("executor", () => rendererActionRegistry.parseConfig(draft.executorType!, draft.executorConfig))
  return errors
}

export function scopedAutomationErrors(errors: AutomationFieldErrors, scope: string): AutomationFieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith(`${scope}.`)).map(([key, message]) => [key.slice(scope.length + 1), message]))
}
