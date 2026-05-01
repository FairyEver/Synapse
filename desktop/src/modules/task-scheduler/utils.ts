import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { SynapseProjectConfig } from "@/types/config"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import type { TaskFormState } from "./types"

const DEFAULT_ACTION_TYPE = "builtin.command"

const DEFAULT_TASK_FORM_STATE: TaskFormState = {
  name: "",
  description: "",
  scopeType: "global",
  projectId: "",
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
  defaultProjectId = "",
  _platform?: string,
): TaskFormState {
  if (!task) {
    return {
      ...DEFAULT_TASK_FORM_STATE,
      projectId: defaultProjectId,
    }
  }

  const isCronTrigger = task.trigger.type === "builtin.cron"
  const isIntervalTrigger = task.trigger.type === "builtin.interval"

  return {
    name: task.name,
    description: task.description ?? "",
    scopeType: task.scope.type,
    projectId: task.scope.type === "project" ? task.scope.projectId : defaultProjectId,
    cwd: task.cwd ?? "",
    enabled: task.enabled,
    triggerType: isCronTrigger ? "cron" : "interval",
    cronExpr: isCronTrigger ? task.trigger.config.expr : DEFAULT_TASK_FORM_STATE.cronExpr,
    everyMinutes: isIntervalTrigger
      ? String(task.trigger.config.everyMinutes)
      : DEFAULT_TASK_FORM_STATE.everyMinutes,
    intervalAnchor: isIntervalTrigger
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

  return {
    name,
    description,
    scope: form.scopeType === "global"
      ? { type: "global" }
      : { type: "project", projectId: requireTrimmed(form.projectId, "项目") },
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
  if (task.scope.type === "global") {
    return "全局"
  }
  const { projectId } = task.scope
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

function formatTaskTrigger(task: ScheduledTask): string {
  if (task.trigger.type === "builtin.cron") {
    return `Cron · ${task.trigger.config.expr}`
  }
  return task.trigger.config.anchor === "last_completed_at"
    ? `每 ${task.trigger.config.everyMinutes} 分钟 · 完成后`
    : `每 ${task.trigger.config.everyMinutes} 分钟`
}

function formatTaskAction(task: ScheduledTask): string {
  try {
    return rendererActionRegistry.summarize(task.action.type, task.action.config)
  } catch {
    return task.action.type
  }
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

export {
  DEFAULT_TASK_FORM_STATE,
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createTaskFormState,
  formatRunStatus,
  formatTaskAction,
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
}
