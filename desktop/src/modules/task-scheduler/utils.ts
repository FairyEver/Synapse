import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskActionRef,
  ScheduledTaskScope,
  ScheduledTaskRun,
  ScheduledTaskStatus,
  ScheduledTaskTrigger,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { SynapseAgentGlobalConfig, SynapseProjectConfig } from "@/types/config"
import { createRendererLogger } from "@/app-shell/logging"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import type { AgentActionConfig } from "../../../action-packages/builtin/agent"
import type { ActionConfig } from "../../../action-packages/types"
import type { TaskExportFile, TaskFormState } from "./types"

const DEFAULT_ACTION_TYPE = "builtin.command"
const WINDOWS_DEFAULT_SHELL = "cmd"
const logger = createRendererLogger("task-scheduler.utils")

const DEFAULT_TASK_FORM_STATE: TaskFormState = {
  name: "",
  description: "",
  cwd: "",
  enabled: true,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  triggerType: "cron",
  cronExpr: "0 9 * * *",
  everyMinutes: "60",
  intervalAnchor: "created_at",
  actionType: DEFAULT_ACTION_TYPE,
  actionConfig: createDefaultTaskActionConfig(DEFAULT_ACTION_TYPE),
  missedRunPolicy: "skip",
}

function createTaskFormState(
  task?: ScheduledTask,
  _defaultProjectId = "",
  platform?: string,
): TaskFormState {
  if (!task) {
    return {
      ...DEFAULT_TASK_FORM_STATE,
      actionConfig: createDefaultTaskActionConfig(DEFAULT_ACTION_TYPE, platform),
    }
  }

  return {
    name: task.name,
    description: task.description ?? "",
    cwd: task.cwd ?? "",
    enabled: task.enabled,
    activeDays: task.activeDays ?? [0, 1, 2, 3, 4, 5, 6],
    triggerType: task.trigger.type === "builtin.cron" ? "cron" : "interval",
    cronExpr: task.trigger.type === "builtin.cron" ? task.trigger.config.expr : DEFAULT_TASK_FORM_STATE.cronExpr,
    everyMinutes: task.trigger.type === "builtin.interval"
      ? String(task.trigger.config.everyMinutes)
      : DEFAULT_TASK_FORM_STATE.everyMinutes,
    intervalAnchor: task.trigger.type === "builtin.interval"
      ? task.trigger.config.anchor ?? "created_at"
      : DEFAULT_TASK_FORM_STATE.intervalAnchor,
    actionType: task.action.type,
    actionConfig: task.action.config,
    missedRunPolicy: task.missedRunPolicy,
  }
}

function createDefaultTaskActionConfig(actionType: string, platform?: string): ActionConfig {
  const baseConfig = rendererActionRegistry.getDefaultConfig(actionType)
  if (platform === "win32" && isShellActionType(actionType)) {
    return {
      ...baseConfig,
      shell: WINDOWS_DEFAULT_SHELL,
    }
  }
  return { ...baseConfig }
}

function isShellActionType(actionType: string): boolean {
  return actionType === "builtin.command" || actionType === "builtin.script"
}

function createDefaultAgentActionConfig(
  agentDefaults: Pick<SynapseAgentGlobalConfig, "defaultPermissionMode" | "defaultProviderModel">,
): AgentActionConfig {
  const baseConfig = rendererActionRegistry.getDefaultConfig("builtin.agent") as AgentActionConfig
  const defaultProviderModel = agentDefaults.defaultProviderModel
  return {
    ...baseConfig,
    mode: agentDefaults.defaultPermissionMode,
    ...(defaultProviderModel
      ? {
          providerId: defaultProviderModel.providerId,
          modelTier: defaultProviderModel.modelTier,
        }
      : {}),
  }
}

function buildTaskCreateInput(form: TaskFormState): ScheduledTaskCreateInput {
  const payload = buildTaskPayload(form)
  return payload
}

function buildTaskUpdateInput(form: TaskFormState): ScheduledTaskUpdateInput {
  return buildTaskPayload(form)
}

function buildTaskPayload(form: TaskFormState): ScheduledTaskCreateInput {
  const name = requireTrimmed(form.name, "名称")
  const description = optionalTrimmed(form.description)
  const cwd = optionalTrimmed(form.cwd)
  const actionConfig = rendererActionRegistry.parseConfig(form.actionType, form.actionConfig)

  const projectId = (actionConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  if (form.activeDays.length === 0) {
    throw new Error("请至少选择一个活跃日")
  }

  return {
    name,
    description,
    scope,
    cwd,
    trigger: form.triggerType === "cron"
      ? { type: "builtin.cron", config: { expr: requireTrimmed(form.cronExpr, "Cron") } }
      : {
          type: "builtin.interval",
          config: {
            everyMinutes: readPositiveInteger(form.everyMinutes, "间隔"),
            anchor: form.intervalAnchor,
          },
        },
    action: {
      type: form.actionType,
      config: actionConfig,
    },
    enabled: form.enabled,
    activeDays: form.activeDays,
    missedRunPolicy: form.missedRunPolicy,
  }
}

function formatTaskScope(task: ScheduledTask, projects: readonly SynapseProjectConfig[]): string {
  const projectId = task.scope.type === "project"
    ? task.scope.projectId
    : (task.action.config as Record<string, unknown>).projectId as string | undefined
  if (!projectId) return "全局"
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

function formatTaskTrigger(task: Pick<ScheduledTask, "trigger">): string {
  if (task.trigger.type === "builtin.cron") {
    return `Cron · ${task.trigger.config.expr}`
  }
  return task.trigger.config.anchor === "last_completed_at"
    ? `每 ${task.trigger.config.everyMinutes} 分钟 · 完成后`
    : `每 ${task.trigger.config.everyMinutes} 分钟`
}

function formatTaskNextRun(
  task: Pick<ScheduledTask, "activeRun" | "enabled" | "nextRunAt" | "trigger">,
  now = new Date(),
): string {
  if (!task.enabled) return "停用中"
  if (isCompletionAnchoredInterval(task) && task.activeRun?.status === "running") {
    return "未知"
  }
  if (!task.nextRunAt) return "未知"
  const nextRunAt = new Date(task.nextRunAt)
  const nextRunAtTime = nextRunAt.getTime()
  if (!Number.isFinite(nextRunAtTime)) return "未知"
  if (nextRunAtTime <= now.getTime()) return "未知"
  return formatTaskDate(task.nextRunAt, "未知")
}

function formatTaskAction(task: ScheduledTask): string {
  try {
    return rendererActionRegistry.summarize(task.action.type, task.action.config)
  } catch (error) {
    logger.warn("Task action summary render failed.", {
      boundary: "task-scheduler.action-summary",
      taskId: task.id,
      actionType: task.action.type,
      configKeys: Object.keys(task.action.config).sort(),
      errorName: getErrorName(error),
      errorLength: getErrorLength(error),
    })
    return task.action.type
  }
}

function isCompletionAnchoredInterval(
  task: Pick<ScheduledTask, "trigger">,
): boolean {
  return task.trigger.type === "builtin.interval" &&
    task.trigger.config.anchor === "last_completed_at"
}

function formatTaskDate(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function formatTaskStatus(status: ScheduledTaskStatus | undefined): string {
  if (!status) return "未运行"
  const labels: Record<ScheduledTaskStatus, string> = {
    success: "成功",
    failed: "失败",
    timeout: "超时",
    cancelled: "已停止",
    skipped: "已跳过",
  }
  return labels[status]
}

function formatRunStatus(run: ScheduledTaskRun): string {
  if (run.status === "running") return "运行中"
  return formatTaskStatus(run.status)
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label}不能为空`)
  }
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

function getErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name
  }
  return typeof error
}

function getErrorLength(error: unknown): number {
  if (error instanceof Error) {
    return error.message.length
  }
  if (typeof error === "string") {
    return error.length
  }
  return 0
}

function serializeTasksForExport(tasks: ScheduledTask[]): TaskExportFile {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((task) => ({
      name: task.name,
      description: task.description,
      scope: task.scope,
      cwd: task.cwd,
      trigger: task.trigger,
      action: task.action,
      activeDays: task.activeDays,
      missedRunPolicy: task.missedRunPolicy,
    })),
  }
}

function parseTaskImportFile(content: string): TaskExportFile {
  const data = JSON.parse(content) as unknown
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    !Array.isArray(data.tasks)
  ) {
    throw new Error("文件格式无效")
  }
  const tasks = data.tasks
  if (!tasks.every(isTaskExportEntry)) {
    throw new Error("文件格式无效")
  }
  return {
    version: 1,
    exportedAt: typeof data.exportedAt === "string"
      ? data.exportedAt
      : "",
    tasks,
  }
}

function isTaskExportEntry(value: unknown): value is TaskExportFile["tasks"][number] {
  if (!isRecord(value)) return false
  return typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.cwd === undefined || typeof value.cwd === "string") &&
    isScheduledTaskScope(value.scope) &&
    isScheduledTaskTrigger(value.trigger) &&
    isScheduledTaskActionRef(value.action) &&
    (value.activeDays === undefined || isActiveDays(value.activeDays)) &&
    (value.missedRunPolicy === "skip" || value.missedRunPolicy === "run_once")
}

function isScheduledTaskScope(value: unknown): value is ScheduledTaskScope {
  if (!isRecord(value)) return false
  if (value.type === "global") return true
  return value.type === "project" && typeof value.projectId === "string" && value.projectId.length > 0
}

function isScheduledTaskTrigger(value: unknown): value is ScheduledTaskTrigger {
  if (!isRecord(value) || !isRecord(value.config)) return false
  if (value.type === "builtin.cron") {
    return typeof value.config.expr === "string" && value.config.expr.length > 0
  }
  if (value.type === "builtin.interval") {
    const everyMinutes = value.config.everyMinutes
    return Number.isInteger(everyMinutes) &&
      typeof everyMinutes === "number" &&
      everyMinutes > 0 &&
      (
        value.config.anchor === undefined ||
        value.config.anchor === "created_at" ||
        value.config.anchor === "last_completed_at"
      )
  }
  return false
}

function isScheduledTaskActionRef(value: unknown): value is ScheduledTaskActionRef {
  return isRecord(value) && typeof value.type === "string" && isRecord(value.config)
}

function isActiveDays(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export {
  DEFAULT_TASK_FORM_STATE,
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createDefaultAgentActionConfig,
  createDefaultTaskActionConfig,
  createTaskFormState,
  formatTaskNextRun,
  formatRunStatus,
  formatTaskAction,
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
  parseTaskImportFile,
  serializeTasksForExport,
}
