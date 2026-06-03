import { createRendererLogger } from "@/app-shell/logging"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import type { AutomationCreateInput, AutomationItem, AutomationRun, AutomationRunStatus, AutomationUpdateInput } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import type { ActionConfig } from "../../../action-packages/types"
import type { AutomationEditorDraft, AutomationFormState } from "./types"

const DEFAULT_EXECUTOR_TYPE = "builtin.command"
const DEFAULT_ACTIVE_DAYS = [0, 1, 2, 3, 4, 5, 6]
const logger = createRendererLogger("automation.utils")

const DEFAULT_AUTOMATION_FORM_STATE: AutomationFormState = {
  name: "",
  description: "",
  cwd: "",
  enabled: true,
  activeDays: DEFAULT_ACTIVE_DAYS,
  triggerType: "cron",
  cronExpr: "0 9 * * *",
  cronTimezone: "",
  everyMinutes: "60",
  intervalAnchor: "created_at",
  executorType: DEFAULT_EXECUTOR_TYPE,
  executorConfig: createDefaultExecutorConfig(DEFAULT_EXECUTOR_TYPE),
  missedRunPolicy: "skip",
}

function createAutomationFormState(item?: AutomationItem): AutomationFormState {
  if (!item) {
    return {
      ...DEFAULT_AUTOMATION_FORM_STATE,
      activeDays: [...DEFAULT_ACTIVE_DAYS],
      executorConfig: createDefaultExecutorConfig(DEFAULT_EXECUTOR_TYPE),
    }
  }
  const triggerConfig = item.trigger.config
  return {
    name: item.name,
    description: item.description ?? "",
    cwd: item.cwd ?? "",
    enabled: item.enabled,
    activeDays: readActiveDays(triggerConfig),
    triggerType: item.trigger.type === "builtin.cron" ? "cron" : "interval",
    cronExpr: item.trigger.type === "builtin.cron" && typeof triggerConfig.expr === "string"
      ? triggerConfig.expr
      : DEFAULT_AUTOMATION_FORM_STATE.cronExpr,
    cronTimezone: item.trigger.type === "builtin.cron" && typeof triggerConfig.timezone === "string"
      ? triggerConfig.timezone
      : "",
    everyMinutes: item.trigger.type === "builtin.interval" && typeof triggerConfig.everyMinutes === "number"
      ? String(triggerConfig.everyMinutes)
      : DEFAULT_AUTOMATION_FORM_STATE.everyMinutes,
    intervalAnchor: item.trigger.type === "builtin.interval" && triggerConfig.anchor === "last_completed_at"
      ? "last_completed_at"
      : "created_at",
    executorType: item.executor.type,
    executorConfig: item.executor.config,
    missedRunPolicy: item.policy.missedRunPolicy,
  }
}

function createDefaultExecutorConfig(executorType: string): ActionConfig {
  return { ...rendererActionRegistry.getDefaultConfig(executorType) }
}

function createDefaultAutomationDraft(): AutomationEditorDraft {
  return {
    name: "",
    description: "",
    cwd: "",
    enabled: false,
    triggerType: null,
    triggerConfig: {},
    executorType: null,
    executorConfig: {},
    missedRunPolicy: "skip",
  }
}

function createAutomationDraftFromItem(item: AutomationItem): AutomationEditorDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    cwd: item.cwd ?? "",
    enabled: item.enabled,
    triggerType: item.trigger.type,
    triggerConfig: item.trigger.config,
    executorType: item.executor.type,
    executorConfig: item.executor.config,
    missedRunPolicy: item.policy.missedRunPolicy,
  }
}

function buildAutomationCreateInput(form: AutomationFormState): AutomationCreateInput {
  return buildAutomationPayload(form)
}

function buildAutomationUpdateInput(form: AutomationFormState): AutomationUpdateInput {
  return buildAutomationPayload(form)
}

function buildAutomationCreateInputFromDraft(
  draft: AutomationEditorDraft,
  enabled: boolean,
): AutomationCreateInput {
  return buildAutomationPayloadFromDraft(draft, enabled)
}

function buildAutomationUpdateInputFromDraft(
  draft: AutomationEditorDraft,
  enabled: boolean,
): AutomationUpdateInput {
  return buildAutomationPayloadFromDraft(draft, enabled)
}

function buildAutomationPayloadFromDraft(
  draft: AutomationEditorDraft,
  enabled: boolean,
): AutomationCreateInput {
  const name = requireTrimmed(draft.name, "名称")
  if (!draft.triggerType) throw new Error("请选择触发器")
  if (!draft.executorType) throw new Error("请选择执行器")
  const triggerConfig = rendererAutomationTriggerRegistry.parseConfig(draft.triggerType, draft.triggerConfig)
  const executorConfig = rendererActionRegistry.parseConfig(draft.executorType, draft.executorConfig)
  const projectId = (executorConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  return {
    name,
    description: optionalTrimmed(draft.description),
    enabled,
    scope,
    cwd: optionalTrimmed(draft.cwd),
    trigger: {
      type: draft.triggerType,
      config: triggerConfig,
    },
    executor: {
      type: draft.executorType,
      config: executorConfig,
    },
    policy: {
      missedRunPolicy: draft.missedRunPolicy,
      overlapPolicy: "skip",
    },
  }
}

function buildAutomationPayload(form: AutomationFormState): AutomationCreateInput {
  const name = requireTrimmed(form.name, "名称")
  const description = optionalTrimmed(form.description)
  const cwd = optionalTrimmed(form.cwd)
  const executorConfig = rendererActionRegistry.parseConfig(form.executorType, form.executorConfig)
  const projectId = (executorConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  if (form.activeDays.length === 0) {
    throw new Error("请至少选择一个活跃日")
  }

  return {
    name,
    description,
    enabled: form.enabled,
    scope,
    cwd,
    trigger: form.triggerType === "cron"
      ? {
          type: "builtin.cron",
          config: {
            expr: requireTrimmed(form.cronExpr, "Cron"),
            ...(optionalTrimmed(form.cronTimezone) ? { timezone: optionalTrimmed(form.cronTimezone) } : {}),
            activeDays: form.activeDays,
          },
        }
      : {
          type: "builtin.interval",
          config: {
            everyMinutes: readPositiveInteger(form.everyMinutes, "间隔"),
            anchor: form.intervalAnchor,
            activeDays: form.activeDays,
          },
        },
    executor: {
      type: form.executorType,
      config: executorConfig,
    },
    policy: {
      missedRunPolicy: form.missedRunPolicy,
      overlapPolicy: "skip",
    },
  }
}

function formatAutomationScope(item: AutomationItem, projects: readonly SynapseProjectConfig[]): string {
  const projectId = item.scope.type === "project"
    ? item.scope.projectId
    : (item.executor.config as Record<string, unknown>).projectId as string | undefined
  if (!projectId) return "全局"
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

function formatAutomationTrigger(item: Pick<AutomationItem, "trigger">): string {
  try {
    return rendererAutomationTriggerRegistry.summarize(item.trigger.type, item.trigger.config)
  } catch (error) {
    logger.warn("Automation trigger summary render failed.", {
      boundary: "automation.trigger-summary",
      triggerType: item.trigger.type,
      configKeys: Object.keys(item.trigger.config).sort(),
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.trigger.type
  }
}

function formatAutomationNextRun(item: Pick<AutomationItem, "activeRun" | "enabled" | "nextRunAt" | "trigger">, now = new Date()): string {
  if (!item.enabled) return "停用中"
  if (isCompletionAnchoredInterval(item) && item.activeRun?.status === "running") return "未知"
  if (!item.nextRunAt) return "未知"
  const nextRunAt = new Date(item.nextRunAt)
  if (!Number.isFinite(nextRunAt.getTime())) return "未知"
  if (nextRunAt.getTime() <= now.getTime()) return "未知"
  return formatAutomationDate(item.nextRunAt, "未知")
}

function formatAutomationExecutor(item: AutomationItem): string {
  try {
    return rendererActionRegistry.summarize(item.executor.type, item.executor.config)
  } catch (error) {
    logger.warn("Automation executor summary render failed.", {
      boundary: "automation.executor-summary",
      automationId: item.id,
      executorType: item.executor.type,
      configKeys: Object.keys(item.executor.config).sort(),
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    return item.executor.type
  }
}

function formatAutomationDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatAutomationStatus(status: AutomationRunStatus | undefined): string {
  if (!status) return "未运行"
  const labels: Record<AutomationRunStatus, string> = {
    success: "成功",
    failed: "失败",
    timeout: "超时",
    cancelled: "已停止",
    skipped: "已跳过",
  }
  return labels[status]
}

function formatAutomationRunStatus(run: AutomationRun): string {
  if (run.status === "running") return "运行中"
  return formatAutomationStatus(run.status)
}

function isCompletionAnchoredInterval(item: Pick<AutomationItem, "trigger">): boolean {
  return item.trigger.type === "builtin.interval" &&
    item.trigger.config.anchor === "last_completed_at"
}

function readActiveDays(config: Record<string, unknown>): number[] {
  const activeDays = config.activeDays
  return Array.isArray(activeDays) && activeDays.every((day) => Number.isInteger(day))
    ? activeDays as number[]
    : [...DEFAULT_ACTIVE_DAYS]
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  return trimmed
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readPositiveInteger(value: string, label: string): number {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error(`${label}需为正整数`)
  }
  return numberValue
}

export {
  DEFAULT_ACTIVE_DAYS,
  DEFAULT_AUTOMATION_FORM_STATE,
  buildAutomationCreateInputFromDraft,
  buildAutomationCreateInput,
  buildAutomationUpdateInputFromDraft,
  buildAutomationUpdateInput,
  createAutomationDraftFromItem,
  createDefaultAutomationDraft,
  createAutomationFormState,
  createDefaultExecutorConfig,
  formatAutomationDate,
  formatAutomationExecutor,
  formatAutomationNextRun,
  formatAutomationRunStatus,
  formatAutomationScope,
  formatAutomationStatus,
  formatAutomationTrigger,
}
