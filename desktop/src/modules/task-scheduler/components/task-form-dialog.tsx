import { useEffect, useState, type FormEvent, type ReactNode } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from "@/types/task-scheduler"
import type { TaskFormDialogState, TaskFormState } from "../types"
import {
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createTaskFormState,
} from "../utils"

type TaskFormDialogProps = {
  open: boolean
  state: TaskFormDialogState
  projects: readonly SynapseProjectConfig[]
  platform?: string
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: ScheduledTaskCreateInput) => Promise<void>
  onUpdate: (id: string, patch: ScheduledTaskUpdateInput) => Promise<void>
}

function TaskFormDialog({
  open,
  state,
  projects,
  platform,
  busy,
  onOpenChange,
  onCreate,
  onUpdate,
}: TaskFormDialogProps) {
  const defaultProjectId = projects[0]?.id ?? ""
  const [form, setForm] = useState<TaskFormState>(() =>
    createTaskFormState(state.task, defaultProjectId, platform),
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(createTaskFormState(state.task, defaultProjectId, platform))
      setError(null)
    }
  }, [defaultProjectId, open, platform, state])

  const updateField = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const canSubmit = Boolean(
    form.name.trim()
    && form.actionContent.trim()
    && (form.scopeType === "global" || form.projectId),
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      if (state.mode === "edit") {
        await onUpdate(state.task.id, buildTaskUpdateInput(form))
      } else {
        await onCreate(buildTaskCreateInput(form))
      }
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败")
    }
  }

  return (
    <Dialog data-track="task-scheduler-form-dialog" open={open} onOpenChange={onOpenChange}>
      <FormDialog
        title={state.mode === "edit" ? "编辑任务" : "新建任务"}
        contentClassName="sm:max-w-[850px]"
        footer={(
          <>
            <FieldError className="sm:mr-auto">{error}</FieldError>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy || !canSubmit}>
                {busy ? "正在保存..." : state.mode === "edit" ? "保存修改" : "保存"}
              </Button>
            </div>
          </>
        )}
        onSubmit={handleSubmit}
      >
        <FieldGroup className="gap-6">
          <TaskFormSection title="基础信息">
            <div className="grid gap-4 sm:grid-cols-2">
              <TaskField label="名称" htmlFor="task-form-name">
                <Input
                  id="task-form-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </TaskField>
              <TaskField label="作用域" htmlFor="task-form-scope">
                <Select
                  value={form.scopeType}
                  onValueChange={(value) => updateField("scopeType", value as TaskFormState["scopeType"])}
                >
                  <SelectTrigger id="task-form-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">全局</SelectItem>
                    <SelectItem value="project">项目</SelectItem>
                  </SelectContent>
                </Select>
              </TaskField>
            </div>

            {form.scopeType === "project" ? (
              <TaskField label="项目" htmlFor="task-form-project">
                <Select
                  value={form.projectId}
                  onValueChange={(value) => updateField("projectId", value)}
                >
                  <SelectTrigger id="task-form-project" className="w-full">
                    <SelectValue placeholder="选择项目" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TaskField>
            ) : null}

            <TaskField label="描述" htmlFor="task-form-description">
              <Input
                id="task-form-description"
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
              />
            </TaskField>
          </TaskFormSection>

          <TaskFormSection title="触发计划">
            <div className="grid gap-4 sm:grid-cols-2">
              <TaskField label="触发方式" htmlFor="task-form-trigger-type">
                <Select
                  value={form.triggerType}
                  onValueChange={(value) => updateField("triggerType", value as TaskFormState["triggerType"])}
                >
                  <SelectTrigger id="task-form-trigger-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cron">Cron</SelectItem>
                    <SelectItem value="interval">固定间隔</SelectItem>
                  </SelectContent>
                </Select>
              </TaskField>

              {form.triggerType === "cron" ? (
                <TaskField label="Cron" htmlFor="task-form-cron">
                  <Input
                    id="task-form-cron"
                    value={form.cronExpr}
                    onChange={(event) => updateField("cronExpr", event.target.value)}
                  />
                </TaskField>
              ) : (
                <TaskField label="间隔分钟" htmlFor="task-form-every-minutes">
                  <Input
                    id="task-form-every-minutes"
                    min={1}
                    type="number"
                    value={form.everyMinutes}
                    onChange={(event) => updateField("everyMinutes", event.target.value)}
                  />
                </TaskField>
              )}
            </div>

            {form.triggerType === "interval" ? (
              <TaskField label="锚点" htmlFor="task-form-interval-anchor">
                <Select
                  value={form.intervalAnchor}
                  onValueChange={(value) => updateField("intervalAnchor", value as TaskFormState["intervalAnchor"])}
                >
                  <SelectTrigger id="task-form-interval-anchor" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_at">创建时间</SelectItem>
                    <SelectItem value="last_completed_at">上次完成</SelectItem>
                  </SelectContent>
                </Select>
              </TaskField>
            ) : null}
          </TaskFormSection>

          <TaskFormSection title="执行内容">
            <div className="grid gap-4 sm:grid-cols-3">
              <TaskField label="执行类型" htmlFor="task-form-action-mode">
                <Select
                  value={form.actionMode}
                  onValueChange={(value) => updateField("actionMode", value as TaskFormState["actionMode"])}
                >
                  <SelectTrigger id="task-form-action-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="command">命令</SelectItem>
                    <SelectItem value="script">脚本</SelectItem>
                  </SelectContent>
                </Select>
              </TaskField>
              <TaskField label="Shell" htmlFor="task-form-shell">
                <Select
                  value={form.actionShell}
                  onValueChange={(value) => updateField("actionShell", value as TaskFormState["actionShell"])}
                >
                  <SelectTrigger id="task-form-shell" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="posix">POSIX sh</SelectItem>
                    <SelectItem value="cmd">cmd.exe</SelectItem>
                    <SelectItem value="powershell">PowerShell</SelectItem>
                  </SelectContent>
                </Select>
              </TaskField>
              <TaskField label="工作目录" htmlFor="task-form-cwd">
                <Input
                  id="task-form-cwd"
                  value={form.cwd}
                  onChange={(event) => updateField("cwd", event.target.value)}
                />
              </TaskField>
            </div>

            <TaskField label={form.actionMode === "script" ? "脚本" : "命令"} htmlFor="task-form-action-content">
              <Textarea
                id="task-form-action-content"
                rows={6}
                value={form.actionContent}
                onChange={(event) => updateField("actionContent", event.target.value)}
              />
            </TaskField>
          </TaskFormSection>

          <TaskFormSection title="运行设置">
            <TaskField label="环境变量" htmlFor="task-form-env">
              <Textarea
                id="task-form-env"
                rows={4}
                value={form.envText}
                onChange={(event) => updateField("envText", event.target.value)}
              />
            </TaskField>

            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleField
                checked={form.enabled}
                label="启用"
                onCheckedChange={(checked) => updateField("enabled", checked)}
              />
              <ToggleField
                checked={form.missedRunPolicy === "run_once"}
                label="补跑一次"
                onCheckedChange={(checked) =>
                  updateField("missedRunPolicy", checked ? "run_once" : "skip")
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
              <ToggleField
                checked={form.timeoutEnabled}
                label="超时"
                onCheckedChange={(checked) => updateField("timeoutEnabled", checked)}
              />
              <TaskField label="分钟" htmlFor="task-form-timeout-mins">
                <Input
                  id="task-form-timeout-mins"
                  disabled={!form.timeoutEnabled}
                  min={1}
                  type="number"
                  value={form.timeoutMins}
                  onChange={(event) => updateField("timeoutMins", event.target.value)}
                />
              </TaskField>
            </div>
          </TaskFormSection>
        </FieldGroup>
      </FormDialog>
    </Dialog>
  )
}

function TaskFormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function TaskField({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode
  htmlFor: string
  label: string
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <FieldContent>{children}</FieldContent>
    </Field>
  )
}

function ToggleField({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="items-center rounded-lg border border-border p-3">
      <FieldLabel>{label}</FieldLabel>
      <FieldContent className="items-end">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </FieldContent>
    </Field>
  )
}

export { TaskFormDialog }
