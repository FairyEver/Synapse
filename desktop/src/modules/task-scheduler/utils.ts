import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { SynapseProjectConfig } from "@/types/config"
import { createRendererLogger } from "@/app-shell/logging"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import type { TaskExportFile, TaskFormState } from "./types"

const DEFAULT_ACTION_TYPE = "builtin.command"
const logger = createRendererLogger("task-scheduler.utils")

const DEFAULT_TASK_FORM_STATE: TaskFormState = {
  name: "",
  description: "",
  cwd: "",
  enabled: true,
  triggerType: "cron",
  cronExpr: "0 9 * * *",
  everyMinutes: "60",
  intervalAnchor: "created_at",
  actionType: DEFAULT_ACTION_TYPE,
  actionConfig: rendererActionRegistry.getDefaultConfig(DEFAULT_ACTION_TYPE),
  missedRunPolicy: "skip",
}

function createTaskFormState(
  task?: ScheduledTask,
  _defaultProjectId = "",
  _platform?: string,
): TaskFormState {
  if (!task) {
    return { ...DEFAULT_TASK_FORM_STATE }
  }

  return {
    name: task.name,
    description: task.description ?? "",
    cwd: task.cwd ?? "",
    enabled: task.enabled,
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
      missedRunPolicy: task.missedRunPolicy,
    })),
  }
}

function parseTaskImportFile(content: string): TaskExportFile {
  const data = JSON.parse(content) as unknown
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    !("tasks" in data) ||
    !Array.isArray((data as { tasks: unknown }).tasks)
  ) {
    throw new Error("文件格式无效")
  }
  return data as TaskExportFile
}

export {
  DEFAULT_TASK_FORM_STATE,
  buildTaskCreateInput,
  buildTaskUpdateInput,
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
