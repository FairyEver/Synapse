import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { SynapseProjectConfig } from "@/types/config"
import type { TaskFormShell, TaskFormState } from "./types"

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
  actionMode: "command",
  actionShell: "posix",
  actionContent: "",
  envText: "",
  timeoutEnabled: true,
  timeoutMins: "30",
  missedRunPolicy: "skip",
}

function createTaskFormState(
  task?: ScheduledTask,
  defaultProjectId = "",
  platform?: string,
): TaskFormState {
  if (!task) {
    return {
      ...DEFAULT_TASK_FORM_STATE,
      projectId: defaultProjectId,
      actionShell: defaultTaskShell(platform),
    }
  }

  return {
    name: task.name,
    description: task.description ?? "",
    scopeType: task.scope.type,
    projectId: task.scope.type === "project" ? task.scope.projectId : defaultProjectId,
    cwd: task.cwd ?? "",
    enabled: task.enabled,
    triggerType: task.trigger.type,
    cronExpr: task.trigger.type === "cron" ? task.trigger.expr : DEFAULT_TASK_FORM_STATE.cronExpr,
    everyMinutes: task.trigger.type === "interval"
      ? String(task.trigger.everyMinutes)
      : DEFAULT_TASK_FORM_STATE.everyMinutes,
    intervalAnchor: task.trigger.type === "interval"
      ? task.trigger.anchor ?? "created_at"
      : DEFAULT_TASK_FORM_STATE.intervalAnchor,
    actionMode: task.action.mode,
    actionShell: task.action.shell ?? defaultTaskShell(platform),
    actionContent: task.action.content,
    envText: stringifyTaskEnv(task.action.env),
    timeoutEnabled: task.action.timeoutMins !== null,
    timeoutMins: String(task.action.timeoutMins ?? 30),
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
  const actionContent = requireTrimmed(form.actionContent, "命令")
  const description = optionalTrimmed(form.description)
  const cwd = optionalTrimmed(form.cwd)
  const env = parseTaskEnv(form.envText)

  return {
    name,
    description,
    scope: form.scopeType === "global"
      ? { type: "global" }
      : { type: "project", projectId: requireTrimmed(form.projectId, "项目") },
    cwd,
    trigger: form.triggerType === "cron"
      ? { type: "cron", expr: requireTrimmed(form.cronExpr, "Cron") }
      : {
          type: "interval",
          everyMinutes: readPositiveInteger(form.everyMinutes, "间隔"),
          anchor: form.intervalAnchor,
        },
    action: {
      type: "shell_command",
      mode: form.actionMode,
      shell: form.actionShell,
      content: actionContent,
      env: Object.keys(env).length > 0 ? env : undefined,
      timeoutMins: form.timeoutEnabled ? readPositiveInteger(form.timeoutMins, "超时") : null,
    },
    enabled: form.enabled,
    missedRunPolicy: form.missedRunPolicy,
  }
}

function defaultTaskShell(platform?: string): TaskFormShell {
  return platform === "win32" ? "cmd" : "posix"
}

function parseTaskEnv(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const separatorIndex = rawLine.indexOf("=")
    if (separatorIndex <= 0) {
      throw new Error("环境变量需使用 KEY=value")
    }
    const key = rawLine.slice(0, separatorIndex).trim()
    if (!key) {
      throw new Error("环境变量名称不能为空")
    }
    result[key] = rawLine.slice(separatorIndex + 1)
  }
  return result
}

function stringifyTaskEnv(env: Record<string, string> | undefined): string {
  if (!env) {
    return ""
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function formatTaskScope(task: ScheduledTask, projects: readonly SynapseProjectConfig[]): string {
  if (task.scope.type === "global") {
    return "全局"
  }
  const { projectId } = task.scope
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

function formatTaskTrigger(task: ScheduledTask): string {
  if (task.trigger.type === "cron") {
    return `Cron · ${task.trigger.expr}`
  }
  return task.trigger.anchor === "last_completed_at"
    ? `每 ${task.trigger.everyMinutes} 分钟 · 完成后`
    : `每 ${task.trigger.everyMinutes} 分钟`
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
  defaultTaskShell,
  formatRunStatus,
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
  parseTaskEnv,
  stringifyTaskEnv,
}
