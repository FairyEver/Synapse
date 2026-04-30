import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

  async function handleSubmit() {
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
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state.mode === "edit" ? "编辑任务" : "新建任务"}</DialogTitle>
          <DialogDescription>保存后按计划执行。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称">
              <Input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </Field>
            <Field label="作用域">
              <Select
                value={form.scopeType}
                onValueChange={(value) => updateField("scopeType", value as TaskFormState["scopeType"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="project">项目</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {form.scopeType === "project" ? (
            <Field label="项目">
              <Select
                value={form.projectId}
                onValueChange={(value) => updateField("projectId", value)}
              >
                <SelectTrigger className="w-full">
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
            </Field>
          ) : null}

          <Field label="描述">
            <Input
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="触发方式">
              <Select
                value={form.triggerType}
                onValueChange={(value) => updateField("triggerType", value as TaskFormState["triggerType"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="interval">固定间隔</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {form.triggerType === "cron" ? (
              <Field label="Cron">
                <Input
                  value={form.cronExpr}
                  onChange={(event) => updateField("cronExpr", event.target.value)}
                />
              </Field>
            ) : (
              <Field label="间隔分钟">
                <Input
                  min={1}
                  type="number"
                  value={form.everyMinutes}
                  onChange={(event) => updateField("everyMinutes", event.target.value)}
                />
              </Field>
            )}
          </div>

          {form.triggerType === "interval" ? (
            <Field label="锚点">
              <Select
                value={form.intervalAnchor}
                onValueChange={(value) => updateField("intervalAnchor", value as TaskFormState["intervalAnchor"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">创建时间</SelectItem>
                  <SelectItem value="last_completed_at">上次完成</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="执行类型">
              <Select
                value={form.actionMode}
                onValueChange={(value) => updateField("actionMode", value as TaskFormState["actionMode"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="command">命令</SelectItem>
                  <SelectItem value="script">脚本</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Shell">
              <Select
                value={form.actionShell}
                onValueChange={(value) => updateField("actionShell", value as TaskFormState["actionShell"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="posix">POSIX sh</SelectItem>
                  <SelectItem value="cmd">cmd.exe</SelectItem>
                  <SelectItem value="powershell">PowerShell</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="工作目录">
              <Input
                value={form.cwd}
                onChange={(event) => updateField("cwd", event.target.value)}
              />
            </Field>
          </div>

          <Field label={form.actionMode === "script" ? "脚本" : "命令"}>
            <Textarea
              value={form.actionContent}
              onChange={(event) => updateField("actionContent", event.target.value)}
            />
          </Field>

          <Field label="环境变量">
            <Textarea
              value={form.envText}
              onChange={(event) => updateField("envText", event.target.value)}
            />
          </Field>

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
            <Field label="分钟">
              <Input
                disabled={!form.timeoutEnabled}
                min={1}
                type="number"
                value={form.timeoutMins}
                onChange={(event) => updateField("timeoutMins", event.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={busy || !canSubmit}
            onClick={() => {
              void handleSubmit()
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export { TaskFormDialog }
