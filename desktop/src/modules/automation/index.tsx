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
import type {
  SynapseCronJob,
  SynapseCronJobDraft,
  SynapseCronMode,
  SynapseCronSessionMode,
  SynapseHeartbeatDraft,
  SynapseHeartbeatStatus,
  SynapseHook,
  SynapseHookDraft,
  SynapseHookEventType,
  SynapseHookHandlerType,
} from "@/types/automation"

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
const HOOK_EVENTS: Array<SynapseHookEventType | "*"> = ["*", "message.received", "message.sent", "session.started", "session.ended", "cron.triggered", "permission.requested", "error"]
const HOOK_TYPES: SynapseHookHandlerType[] = ["command", "http"]

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

type AutomationTab = "cron" | "heartbeat" | "hooks"

type HeartbeatFormState = {
  project: string
  enabled: boolean
  intervalMins: string
  onlyWhenIdle: boolean
  sessionKey: string
  prompt: string
  silent: boolean
  timeoutMins: string
  workDir: string
}

type HookFormState = {
  id: string | null
  project: string
  event: SynapseHookEventType | "*"
  type: SynapseHookHandlerType
  command: string
  url: string
  timeout: string
  async: boolean
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

function emptyHeartbeatForm(project = ""): HeartbeatFormState {
  return {
    project,
    enabled: true,
    intervalMins: "30",
    onlyWhenIdle: true,
    sessionKey: "",
    prompt: "",
    silent: true,
    timeoutMins: "30",
    workDir: "",
  }
}

function heartbeatFormFromStatus(status: SynapseHeartbeatStatus): HeartbeatFormState {
  return {
    project: status.project,
    enabled: status.enabled,
    intervalMins: String(status.intervalMins),
    onlyWhenIdle: status.onlyWhenIdle,
    sessionKey: status.sessionKey,
    prompt: status.prompt,
    silent: status.silent,
    timeoutMins: String(status.timeoutMins),
    workDir: status.workDir,
  }
}

function heartbeatDraftFromForm(form: HeartbeatFormState): SynapseHeartbeatDraft {
  return {
    project: form.project,
    enabled: form.enabled,
    intervalMins: Number.parseInt(form.intervalMins, 10),
    onlyWhenIdle: form.onlyWhenIdle,
    sessionKey: form.sessionKey,
    prompt: form.prompt,
    silent: form.silent,
    timeoutMins: Number.parseInt(form.timeoutMins, 10),
    workDir: form.workDir,
  }
}

function emptyHookForm(project = ""): HookFormState {
  return {
    id: null,
    project,
    event: "message.received",
    type: "command",
    command: "",
    url: "",
    timeout: "",
    async: true,
  }
}

function hookFormFromHook(hook: SynapseHook): HookFormState {
  return {
    id: hook.id,
    project: hook.project,
    event: hook.event,
    type: hook.type,
    command: hook.command,
    url: hook.url,
    timeout: hook.timeout === null ? "" : String(hook.timeout),
    async: hook.async,
  }
}

function hookDraftFromForm(form: HookFormState): SynapseHookDraft {
  return {
    project: form.project,
    event: form.event,
    type: form.type,
    command: form.command,
    url: form.url,
    timeout: form.timeout.trim() ? Number.parseInt(form.timeout, 10) : null,
    async: form.async,
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
  const [activeTab, setActiveTab] = useState<AutomationTab>("cron")
  const [jobs, setJobs] = useState<SynapseCronJob[]>([])
  const [heartbeats, setHeartbeats] = useState<SynapseHeartbeatStatus[]>([])
  const [hooks, setHooks] = useState<SynapseHook[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CronFormState>(() => emptyForm(projects[0]?.name ?? ""))
  const [heartbeatFormOpen, setHeartbeatFormOpen] = useState(false)
  const [heartbeatForm, setHeartbeatForm] = useState<HeartbeatFormState>(() => emptyHeartbeatForm(projects[0]?.name ?? ""))
  const [hookFormOpen, setHookFormOpen] = useState(false)
  const [hookForm, setHookForm] = useState<HookFormState>(() => emptyHookForm(projects[0]?.name ?? ""))
  const [pendingExec, setPendingExec] = useState<CronFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SynapseCronJob | null>(null)
  const [hookDeleteTarget, setHookDeleteTarget] = useState<SynapseHook | null>(null)

  const projectOptions = useMemo(() => projects.map((project) => project.name || project.id), [projects])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const automation = requireBridgeDomain("automation")
      const [cronResult, heartbeatResult, hookResult] = await Promise.all([
        automation.listCron(),
        automation.listHeartbeat(),
        automation.listHooks(),
      ])
      setJobs(cronResult.jobs)
      setHeartbeats(heartbeatResult.heartbeats)
      setHooks(hookResult.hooks)
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
    const project = projectOptions[0] ?? ""
    if (activeTab === "heartbeat") {
      setHeartbeatForm(emptyHeartbeatForm(project))
      setHeartbeatFormOpen(true)
      return
    }
    if (activeTab === "hooks") {
      setHookForm(emptyHookForm(project))
      setHookFormOpen(true)
      return
    }
    setForm(emptyForm(project))
    setFormOpen(true)
  }, [activeTab, projectOptions])

  const openEdit = useCallback((job: SynapseCronJob) => {
    setForm(formFromJob(job))
    setFormOpen(true)
  }, [])

  const openHeartbeatEdit = useCallback((status: SynapseHeartbeatStatus) => {
    setHeartbeatForm(heartbeatFormFromStatus(status))
    setHeartbeatFormOpen(true)
  }, [])

  const openHookEdit = useCallback((hook: SynapseHook) => {
    setHookForm(hookFormFromHook(hook))
    setHookFormOpen(true)
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

  const saveHeartbeat = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await requireBridgeDomain("automation").upsertHeartbeat(heartbeatDraftFromForm(heartbeatForm))
      setHeartbeatFormOpen(false)
      await refresh()
    } catch (saveError) {
      logger.error("Failed to save heartbeat.", saveError)
      setError(saveError instanceof Error ? saveError.message : "保存 Heartbeat 失败。")
    } finally {
      setSaving(false)
    }
  }, [heartbeatForm, refresh])

  const toggleHeartbeatPause = useCallback(async (status: SynapseHeartbeatStatus) => {
    setError(null)
    try {
      const automation = requireBridgeDomain("automation")
      if (status.paused) {
        await automation.resumeHeartbeat({ project: status.project })
      } else {
        await automation.pauseHeartbeat({ project: status.project })
      }
      await refresh()
    } catch (toggleError) {
      logger.error("Failed to toggle heartbeat.", toggleError)
      setError(toggleError instanceof Error ? toggleError.message : "更新 Heartbeat 失败。")
    }
  }, [refresh])

  const triggerHeartbeat = useCallback(async (status: SynapseHeartbeatStatus) => {
    setError(null)
    try {
      await requireBridgeDomain("automation").triggerHeartbeat({ project: status.project })
      await refresh()
    } catch (triggerError) {
      logger.error("Failed to trigger heartbeat.", triggerError)
      setError(triggerError instanceof Error ? triggerError.message : "运行 Heartbeat 失败。")
    }
  }, [refresh])

  const saveHook = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const draft = hookDraftFromForm(hookForm)
      if (hookForm.id) {
        await requireBridgeDomain("automation").updateHook({ id: hookForm.id, patch: draft })
      } else {
        await requireBridgeDomain("automation").createHook(draft)
      }
      setHookFormOpen(false)
      await refresh()
    } catch (saveError) {
      logger.error("Failed to save hook.", saveError)
      setError(saveError instanceof Error ? saveError.message : "保存 Hook 失败。")
    } finally {
      setSaving(false)
    }
  }, [hookForm, refresh])

  const testHook = useCallback(async (hook: SynapseHook) => {
    setError(null)
    try {
      await requireBridgeDomain("automation").testHook({ id: hook.id })
      await refresh()
    } catch (testError) {
      logger.error("Failed to test hook.", testError)
      setError(testError instanceof Error ? testError.message : "测试 Hook 失败。")
    }
  }, [refresh])

  const deleteHook = useCallback(async (hook: SynapseHook) => {
    setError(null)
    try {
      await requireBridgeDomain("automation").deleteHook({ id: hook.id })
      await refresh()
    } catch (deleteError) {
      logger.error("Failed to delete hook.", deleteError)
      setError(deleteError instanceof Error ? deleteError.message : "删除 Hook 失败。")
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AutomationTab)} className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="cron">定时任务</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
        </TabsList>

        <TabsContent value="cron" className="mt-4">
          <CronTable jobs={jobs} loading={loading} onEdit={openEdit} onToggle={toggleJob} onDelete={setDeleteTarget} />
        </TabsContent>
        <TabsContent value="heartbeat" className="mt-4">
          <HeartbeatTable
            heartbeats={heartbeats}
            loading={loading}
            onEdit={openHeartbeatEdit}
            onTogglePause={toggleHeartbeatPause}
            onTrigger={triggerHeartbeat}
          />
        </TabsContent>
        <TabsContent value="hooks" className="mt-4">
          <HooksTable
            hooks={hooks}
            loading={loading}
            onEdit={openHookEdit}
            onTest={testHook}
            onDelete={setHookDeleteTarget}
          />
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

      <HeartbeatDialog
        open={heartbeatFormOpen}
        form={heartbeatForm}
        projects={projectOptions}
        saving={saving}
        onOpenChange={setHeartbeatFormOpen}
        onFormChange={setHeartbeatForm}
        onSave={() => void saveHeartbeat()}
      />

      <HookDialog
        open={hookFormOpen}
        form={hookForm}
        projects={projectOptions}
        saving={saving}
        onOpenChange={setHookFormOpen}
        onFormChange={setHookForm}
        onSave={() => void saveHook()}
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

      <AlertDialog open={Boolean(hookDeleteTarget)} onOpenChange={(open) => !open && setHookDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Hook</AlertDialogTitle>
            <AlertDialogDescription>{hookDeleteTarget ? `${hookDeleteTarget.event} · ${hookDeleteTarget.type}` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (hookDeleteTarget) {
                  void deleteHook(hookDeleteTarget)
                }
                setHookDeleteTarget(null)
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

function HeartbeatTable({
  heartbeats,
  loading,
  onEdit,
  onTogglePause,
  onTrigger,
}: {
  heartbeats: SynapseHeartbeatStatus[]
  loading: boolean
  onEdit: (status: SynapseHeartbeatStatus) => void
  onTogglePause: (status: SynapseHeartbeatStatus) => void
  onTrigger: (status: SynapseHeartbeatStatus) => void
}) {
  if (loading && heartbeats.length === 0) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  if (heartbeats.length === 0) {
    return <AutomationEmpty title="暂无 Heartbeat" icon={<HeartPulse />} />
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>项目</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>Session Key</TableHead>
            <TableHead className="text-right">间隔</TableHead>
            <TableHead className="text-right">运行</TableHead>
            <TableHead>上次运行</TableHead>
            <TableHead>错误</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {heartbeats.map((status) => (
            <TableRow key={status.project}>
              <TableCell className="font-medium">{status.project}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Badge variant={status.enabled ? "secondary" : "outline"}>{status.enabled ? "启用" : "停用"}</Badge>
                  {status.paused ? <Badge variant="outline">暂停</Badge> : null}
                  {status.onlyWhenIdle ? <Badge variant="outline">Idle</Badge> : null}
                </div>
              </TableCell>
              <TableCell>
                <code className="text-xs">{status.sessionKey || "-"}</code>
              </TableCell>
              <TableCell className="text-right">{status.intervalMins} 分钟</TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col gap-1">
                  <span>{status.runCount}</span>
                  <span className="text-xs text-muted-foreground">失败 {status.errorCount} · 忙碌 {status.skippedBusy}</span>
                </div>
              </TableCell>
              <TableCell>{status.lastRun ? formatDateTime(status.lastRun) : "-"}</TableCell>
              <TableCell>
                <span className="line-clamp-2 text-sm text-destructive">{status.lastError}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onTrigger(status)} aria-label="运行">
                    <Terminal className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onTogglePause(status)} aria-label={status.paused ? "恢复" : "暂停"}>
                    <Power className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onEdit(status)} aria-label="编辑">
                    <Pencil className="size-4" />
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

function hookTarget(hook: SynapseHook): string {
  return hook.type === "command" ? hook.command : hook.url
}

function HooksTable({
  hooks,
  loading,
  onEdit,
  onTest,
  onDelete,
}: {
  hooks: SynapseHook[]
  loading: boolean
  onEdit: (hook: SynapseHook) => void
  onTest: (hook: SynapseHook) => void
  onDelete: (hook: SynapseHook) => void
}) {
  if (loading && hooks.length === 0) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  if (hooks.length === 0) {
    return <AutomationEmpty title="暂无 Hook" icon={<Webhook />} />
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hook</TableHead>
            <TableHead>项目</TableHead>
            <TableHead>目标</TableHead>
            <TableHead className="text-right">超时</TableHead>
            <TableHead>最近结果</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hooks.map((hook) => (
            <TableRow key={hook.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Webhook className="size-4 text-muted-foreground" />
                  <span className="font-medium">{hook.event}</span>
                  <Badge variant="outline">{hook.type}</Badge>
                  {hook.async ? <Badge variant="outline">Async</Badge> : null}
                </div>
              </TableCell>
              <TableCell>{hook.project}</TableCell>
              <TableCell>
                <code className="line-clamp-2 text-xs">{hookTarget(hook) || "-"}</code>
              </TableCell>
              <TableCell className="text-right">{hook.timeout ?? (hook.type === "http" ? 5 : 10)} 秒</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span>{hook.lastRun ? formatDateTime(hook.lastRun) : "-"}</span>
                  {hook.lastError ? <span className="line-clamp-1 text-xs text-destructive">{hook.lastError}</span> : null}
                  {hook.lastResult && !hook.lastError ? <span className="line-clamp-1 text-xs text-muted-foreground">{hook.lastResult}</span> : null}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onTest(hook)} aria-label="测试">
                    <Terminal className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onEdit(hook)} aria-label="编辑">
                    <Pencil className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onDelete(hook)} aria-label="删除">
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

function HeartbeatDialog({
  open,
  form,
  projects,
  saving,
  onOpenChange,
  onFormChange,
  onSave,
}: {
  open: boolean
  form: HeartbeatFormState
  projects: string[]
  saving: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (form: HeartbeatFormState) => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="heartbeat-dialog">
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.project ? "编辑 Heartbeat" : "新建 Heartbeat"}</DialogTitle>
          <DialogDescription>Heartbeat 会按间隔发送检查消息。</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>项目</FieldLabel>
              <NativeSelect className="w-full" value={form.project} onChange={(event) => onFormChange({ ...form, project: event.currentTarget.value })}>
                {projects.map((project) => (
                  <NativeSelectOption key={project} value={project}>{project}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>Session Key</FieldLabel>
              <Input value={form.sessionKey} onChange={(event) => onFormChange({ ...form, sessionKey: event.currentTarget.value })} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>间隔分钟</FieldLabel>
              <Input value={form.intervalMins} inputMode="numeric" onChange={(event) => onFormChange({ ...form, intervalMins: event.currentTarget.value })} />
            </Field>
            <Field>
              <FieldLabel>超时分钟</FieldLabel>
              <Input value={form.timeoutMins} inputMode="numeric" onChange={(event) => onFormChange({ ...form, timeoutMins: event.currentTarget.value })} />
            </Field>
          </div>

          <Field>
            <FieldLabel>Prompt</FieldLabel>
            <Textarea value={form.prompt} rows={4} onChange={(event) => onFormChange({ ...form, prompt: event.currentTarget.value })} />
          </Field>

          <Field>
            <FieldLabel>Work Dir</FieldLabel>
            <Input value={form.workDir} onChange={(event) => onFormChange({ ...form, workDir: event.currentTarget.value })} />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field orientation="horizontal">
              <FieldLabel>启用</FieldLabel>
              <Switch checked={form.enabled} onCheckedChange={(checked) => onFormChange({ ...form, enabled: checked })} />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel>Idle Only</FieldLabel>
              <Switch checked={form.onlyWhenIdle} onCheckedChange={(checked) => onFormChange({ ...form, onlyWhenIdle: checked })} />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel>Silent</FieldLabel>
              <Switch checked={form.silent} onCheckedChange={(checked) => onFormChange({ ...form, silent: checked })} />
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="button"
            disabled={saving || !form.project || !form.intervalMins.trim() || !form.timeoutMins.trim()}
            onClick={onSave}
          >
            {saving ? <Loader2 data-icon="inline-start" className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HookDialog({
  open,
  form,
  projects,
  saving,
  onOpenChange,
  onFormChange,
  onSave,
}: {
  open: boolean
  form: HookFormState
  projects: string[]
  saving: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (form: HookFormState) => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="hook-dialog">
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "编辑 Hook" : "新建 Hook"}</DialogTitle>
          <DialogDescription>{form.type === "command" ? "Command Hook 需要权限确认。" : "HTTP Hook 会发送 JSON 请求。"}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>项目</FieldLabel>
              <NativeSelect className="w-full" value={form.project} onChange={(event) => onFormChange({ ...form, project: event.currentTarget.value })}>
                {projects.map((project) => (
                  <NativeSelectOption key={project} value={project}>{project}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>事件</FieldLabel>
              <NativeSelect value={form.event} onChange={(event) => onFormChange({ ...form, event: event.currentTarget.value as HookFormState["event"] })}>
                {HOOK_EVENTS.map((eventName) => (
                  <NativeSelectOption key={eventName} value={eventName}>{eventName}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>类型</FieldLabel>
              <NativeSelect value={form.type} onChange={(event) => onFormChange({ ...form, type: event.currentTarget.value as HookFormState["type"] })}>
                {HOOK_TYPES.map((type) => (
                  <NativeSelectOption key={type} value={type}>{type}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>超时秒</FieldLabel>
              <Input value={form.timeout} inputMode="numeric" onChange={(event) => onFormChange({ ...form, timeout: event.currentTarget.value })} />
            </Field>
          </div>

          {form.type === "command" ? (
            <Field>
              <FieldLabel>Command</FieldLabel>
              <Input value={form.command} onChange={(event) => onFormChange({ ...form, command: event.currentTarget.value })} />
            </Field>
          ) : (
            <Field>
              <FieldLabel>URL</FieldLabel>
              <Input value={form.url} onChange={(event) => onFormChange({ ...form, url: event.currentTarget.value })} />
            </Field>
          )}

          <Field orientation="horizontal">
            <FieldLabel>Async</FieldLabel>
            <Switch checked={form.async} onCheckedChange={(checked) => onFormChange({ ...form, async: checked })} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="button"
            disabled={saving || !form.project || (form.type === "command" ? !form.command.trim() : !form.url.trim())}
            onClick={onSave}
          >
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
