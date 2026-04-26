import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Clock, HeartPulse, Loader2, Pencil, Plus, Power, Terminal, Trash2, Webhook } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { formatDateTime } from "@/lib/date-time"
import type { SynapseCronJob, SynapseCronJobDraft, SynapseCronMode, SynapseCronSessionMode } from "@/types/automation"

const logger = createRendererLogger("automation")

const CRON_PRESETS = [
  { label: "每分钟", expr: "* * * * *" },
  { label: "每 5 分钟", expr: "*/5 * * * *" },
  { label: "每 15 分钟", expr: "*/15 * * * *" },
  { label: "每 30 分钟", expr: "*/30 * * * *" },
  { label: "每小时", expr: "0 * * * *" },
  { label: "每 2 小时", expr: "0 */2 * * *" },
  { label: "每天 6:00", expr: "0 6 * * *" },
  { label: "每天 9:00", expr: "0 9 * * *" },
  { label: "工作日 9:00", expr: "0 9 * * 1-5" },
  { label: "每周一 9:00", expr: "0 9 * * 1" },
  { label: "每月 1 号", expr: "0 0 1 * *" },
]

const MODE_OPTIONS: SynapseCronMode[] = ["", "default", "bypassPermissions", "acceptEdits", "plan", "auto", "dontAsk"]
const SESSION_MODE_OPTIONS: SynapseCronSessionMode[] = ["", "new_per_run"]

type CronFormState = {
  id: string | null
  kind: "prompt" | "exec"
  project: string
  sessionKey: string
  cronExpr: string
  prompt: string
  exec: string
  workDir: string
  description: string
  enabled: boolean
  silent: boolean
  mute: boolean
  sessionMode: SynapseCronSessionMode
  mode: SynapseCronMode
  timeoutMins: string
}

function emptyForm(project = ""): CronFormState {
  return {
    id: null,
    kind: "prompt",
    project,
    sessionKey: "",
    cronExpr: "0 9 * * *",
    prompt: "",
    exec: "",
    workDir: "",
    description: "",
    enabled: true,
    silent: false,
    mute: false,
    sessionMode: "",
    mode: "",
    timeoutMins: "",
  }
}

function formFromJob(job: SynapseCronJob): CronFormState {
  return {
    id: job.id,
    kind: job.exec ? "exec" : "prompt",
    project: job.project,
    sessionKey: job.sessionKey,
    cronExpr: job.cronExpr,
    prompt: job.prompt,
    exec: job.exec,
    workDir: job.workDir,
    description: job.description,
    enabled: job.enabled,
    silent: job.silent,
    mute: job.mute,
    sessionMode: job.sessionMode,
    mode: job.mode,
    timeoutMins: job.timeoutMins === null ? "" : String(job.timeoutMins),
  }
}

function draftFromForm(form: CronFormState, permissionDecision?: "allow" | "deny"): SynapseCronJobDraft {
  return {
    project: form.project,
    sessionKey: form.sessionKey,
    cronExpr: form.cronExpr,
    prompt: form.kind === "prompt" ? form.prompt : "",
    exec: form.kind === "exec" ? form.exec : "",
    workDir: form.workDir,
    description: form.description,
    enabled: form.enabled,
    silent: form.silent,
    mute: form.mute,
    sessionMode: form.sessionMode,
    mode: form.mode,
    timeoutMins: form.timeoutMins.trim() ? Number.parseInt(form.timeoutMins, 10) : null,
    ...(permissionDecision ? { permissionDecision } : undefined),
  }
}

function displayTitle(job: SynapseCronJob): string {
  return job.description || job.prompt || job.exec || job.id
}

function AutomationModule() {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const [jobs, setJobs] = useState<SynapseCronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CronFormState>(() => emptyForm(projects[0]?.name ?? ""))
  const [pendingExec, setPendingExec] = useState<CronFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SynapseCronJob | null>(null)

  const projectOptions = useMemo(() => projects.map((project) => project.name || project.id), [projects])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await requireBridgeDomain("automation").listCron()
      setJobs(result.jobs)
    } catch (loadError) {
      logger.error("Failed to load cron jobs.", loadError)
      setError(loadError instanceof Error ? loadError.message : "读取定时任务失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openCreate = useCallback(() => {
    setForm(emptyForm(projectOptions[0] ?? ""))
    setFormOpen(true)
  }, [projectOptions])

  const openEdit = useCallback((job: SynapseCronJob) => {
    setForm(formFromJob(job))
    setFormOpen(true)
  }, [])

  const saveForm = useCallback(async (nextForm: CronFormState, permissionDecision?: "allow" | "deny") => {
    setSaving(true)
    setError(null)
    try {
      const draft = draftFromForm(nextForm, permissionDecision)
      const result = nextForm.id
        ? await requireBridgeDomain("automation").updateCron({ id: nextForm.id, patch: draft })
        : await requireBridgeDomain("automation").createCron(draft)

      if (result.status === "permission_required") {
        setPendingExec(nextForm)
        return
      }
      if (result.status === "denied") {
        setPendingExec(null)
        return
      }
      setFormOpen(false)
      setPendingExec(null)
      await refresh()
    } catch (saveError) {
      logger.error("Failed to save cron job.", saveError)
      setError(saveError instanceof Error ? saveError.message : "保存定时任务失败。")
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const toggleJob = useCallback(async (job: SynapseCronJob) => {
    setError(null)
    try {
      await requireBridgeDomain("automation").toggleCron({ id: job.id, enabled: !job.enabled })
      await refresh()
    } catch (toggleError) {
      logger.error("Failed to toggle cron job.", toggleError)
      setError(toggleError instanceof Error ? toggleError.message : "更新定时任务失败。")
    }
  }, [refresh])

  const deleteJob = useCallback(async (job: SynapseCronJob) => {
    setError(null)
    try {
      await requireBridgeDomain("automation").deleteCron({ id: job.id })
      await refresh()
    } catch (deleteError) {
      logger.error("Failed to delete cron job.", deleteError)
      setError(deleteError instanceof Error ? deleteError.message : "删除定时任务失败。")
    }
  }, [refresh])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="automation">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">自动化</h1>
        <Button type="button" onClick={openCreate}>
          <Plus data-icon="inline-start" className="size-4" />
          新建
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="cron" className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="cron">定时任务</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
        </TabsList>

        <TabsContent value="cron" className="mt-4">
          <CronTable jobs={jobs} loading={loading} onEdit={openEdit} onToggle={toggleJob} onDelete={setDeleteTarget} />
        </TabsContent>
        <TabsContent value="heartbeat" className="mt-4">
          <AutomationEmpty title="Heartbeat" icon={<HeartPulse />} />
        </TabsContent>
        <TabsContent value="hooks" className="mt-4">
          <AutomationEmpty title="Hooks" icon={<Webhook />} />
        </TabsContent>
      </Tabs>

      <CronDialog
        open={formOpen}
        form={form}
        projects={projectOptions}
        saving={saving}
        onOpenChange={setFormOpen}
        onFormChange={setForm}
        onSave={() => void saveForm(form)}
      />

      <AlertDialog open={Boolean(pendingExec)} onOpenChange={(open) => !open && setPendingExec(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认 Exec</AlertDialogTitle>
            <AlertDialogDescription>Exec 任务会在运行时执行命令。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} onClick={() => void (pendingExec && saveForm(pendingExec, "deny"))}>
              拒绝
            </AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void (pendingExec && saveForm(pendingExec, "allow"))}>
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除定时任务</AlertDialogTitle>
            <AlertDialogDescription>{deleteTarget ? displayTitle(deleteTarget) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  void deleteJob(deleteTarget)
                }
                setDeleteTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function CronTable({
  jobs,
  loading,
  onEdit,
  onToggle,
  onDelete,
}: {
  jobs: SynapseCronJob[]
  loading: boolean
  onEdit: (job: SynapseCronJob) => void
  onToggle: (job: SynapseCronJob) => void
  onDelete: (job: SynapseCronJob) => void
}) {
  if (loading && jobs.length === 0) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  if (jobs.length === 0) {
    return <AutomationEmpty title="暂无定时任务" icon={<Clock />} />
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>项目</TableHead>
            <TableHead>计划</TableHead>
            <TableHead>下次运行</TableHead>
            <TableHead>最近结果</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {job.exec ? <Terminal className="size-4 text-muted-foreground" /> : <Clock className="size-4 text-muted-foreground" />}
                    <span className="truncate font-medium">{displayTitle(job)}</span>
                    <Badge variant={job.enabled ? "secondary" : "outline"}>{job.enabled ? "启用" : "停用"}</Badge>
                    {job.exec ? <Badge variant="outline">Exec</Badge> : <Badge variant="outline">Prompt</Badge>}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{job.id}</span>
                </div>
              </TableCell>
              <TableCell>{job.project}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <code className="text-xs">{job.cronExpr}</code>
                  <span className="text-xs text-muted-foreground">{job.scheduleText}</span>
                </div>
              </TableCell>
              <TableCell>{job.nextRunAt ? formatDateTime(job.nextRunAt) : "-"}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span>{job.lastRun ? formatDateTime(job.lastRun) : "-"}</span>
                  {job.lastError ? <span className="text-xs text-destructive">{job.lastError}</span> : null}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onToggle(job)} aria-label={job.enabled ? "停用" : "启用"}>
                    <Power className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onEdit(job)} aria-label="编辑">
                    <Pencil className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onDelete(job)} aria-label="删除">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CronDialog({
  open,
  form,
  projects,
  saving,
  onOpenChange,
  onFormChange,
  onSave,
}: {
  open: boolean
  form: CronFormState
  projects: string[]
  saving: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (form: CronFormState) => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="cron-dialog">
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "编辑定时任务" : "新建定时任务"}</DialogTitle>
          <DialogDescription>{form.kind === "exec" ? "Exec 任务保存前需要确认。" : "Prompt 任务会按计划发送消息。"}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>项目</FieldLabel>
              <NativeSelect
                className="w-full"
                value={form.project}
                onChange={(event) => onFormChange({ ...form, project: event.currentTarget.value })}
              >
                {projects.map((project) => (
                  <NativeSelectOption key={project} value={project}>{project}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>Schedule</FieldLabel>
              <NativeSelect
                className="w-full"
                value={CRON_PRESETS.some((preset) => preset.expr === form.cronExpr) ? form.cronExpr : "custom"}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (value !== "custom") onFormChange({ ...form, cronExpr: value })
                }}
              >
                {CRON_PRESETS.map((preset) => (
                  <NativeSelectOption key={preset.expr} value={preset.expr}>{preset.label}</NativeSelectOption>
                ))}
                <NativeSelectOption value="custom">自定义</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>

          <Field>
            <FieldLabel>Cron 表达式</FieldLabel>
            <Input value={form.cronExpr} onChange={(event) => onFormChange({ ...form, cronExpr: event.currentTarget.value })} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>类型</FieldLabel>
              <NativeSelect value={form.kind} onChange={(event) => onFormChange({ ...form, kind: event.currentTarget.value as CronFormState["kind"] })}>
                <NativeSelectOption value="prompt">Prompt</NativeSelectOption>
                <NativeSelectOption value="exec">Exec</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>权限模式</FieldLabel>
              <NativeSelect value={form.mode} onChange={(event) => onFormChange({ ...form, mode: event.currentTarget.value as SynapseCronMode })}>
                {MODE_OPTIONS.map((mode) => (
                  <NativeSelectOption key={mode || "empty"} value={mode}>{mode || "项目默认"}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {form.kind === "prompt" ? (
            <Field>
              <FieldLabel>Prompt</FieldLabel>
              <Textarea value={form.prompt} rows={4} onChange={(event) => onFormChange({ ...form, prompt: event.currentTarget.value })} />
            </Field>
          ) : (
            <Field>
              <FieldLabel>Exec</FieldLabel>
              <Input value={form.exec} onChange={(event) => onFormChange({ ...form, exec: event.currentTarget.value })} />
            </Field>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Session Key</FieldLabel>
              <Input value={form.sessionKey} onChange={(event) => onFormChange({ ...form, sessionKey: event.currentTarget.value })} />
            </Field>
            <Field>
              <FieldLabel>Work Dir</FieldLabel>
              <Input value={form.workDir} onChange={(event) => onFormChange({ ...form, workDir: event.currentTarget.value })} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>描述</FieldLabel>
              <Input value={form.description} onChange={(event) => onFormChange({ ...form, description: event.currentTarget.value })} />
            </Field>
            <Field>
              <FieldLabel>超时分钟</FieldLabel>
              <Input value={form.timeoutMins} inputMode="numeric" onChange={(event) => onFormChange({ ...form, timeoutMins: event.currentTarget.value })} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field orientation="horizontal">
              <FieldLabel>启用</FieldLabel>
              <Switch checked={form.enabled} onCheckedChange={(checked) => onFormChange({ ...form, enabled: checked })} />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel>Silent</FieldLabel>
              <Switch checked={form.silent} onCheckedChange={(checked) => onFormChange({ ...form, silent: checked })} />
            </Field>
            <Field>
              <FieldLabel>Session Mode</FieldLabel>
              <NativeSelect value={form.sessionMode} onChange={(event) => onFormChange({ ...form, sessionMode: event.currentTarget.value as SynapseCronSessionMode })}>
                {SESSION_MODE_OPTIONS.map((mode) => (
                  <NativeSelectOption key={mode || "reuse"} value={mode}>{mode || "reuse"}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={saving || !form.project || !form.cronExpr || (form.kind === "prompt" ? !form.prompt.trim() : !form.exec.trim())} onClick={onSave}>
            {saving ? <Loader2 data-icon="inline-start" className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AutomationEmpty({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <Empty className="min-h-64 rounded-lg border bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>暂无数据。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  )
}

export { AutomationModule }
