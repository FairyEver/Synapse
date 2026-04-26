import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  VolumeX,
} from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/date-time"
import type {
  SynapseConnectorStatus,
  SynapseFeishuConnectorRuntimeStatus,
  SynapseFeishuHeartbeatWithProject,
  SynapseFeishuScheduledJobWithProject,
} from "@/types/connectors"
import type { SynapseProjectConfig } from "@/types/config"

const logger = createRendererLogger("settings.scheduled-tasks")

type ScheduledTasksPanelProps = {
  projects: SynapseProjectConfig[]
}

type ConnectorFilter = "all" | "configured" | "running" | "error" | "missing"

function ScheduledTasksPanel({ projects }: ScheduledTasksPanelProps) {
  const { promise } = useAppNotifications()
  const [jobs, setJobs] = useState<SynapseFeishuScheduledJobWithProject[]>([])
  const [heartbeats, setHeartbeats] = useState<SynapseFeishuHeartbeatWithProject[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [projectFilter, setProjectFilter] = useState("all")
  const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>("all")
  const [projectStatuses, setProjectStatuses] = useState<Record<string, SynapseFeishuConnectorRuntimeStatus>>({})
  const [jobProjectId, setJobProjectId] = useState("")
  const [jobKind, setJobKind] = useState<"prompt" | "exec">("prompt")
  const [jobSessionKey, setJobSessionKey] = useState("")
  const [jobCronExpr, setJobCronExpr] = useState("")
  const [jobBody, setJobBody] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [jobSessionMode, setJobSessionMode] = useState<"reuse" | "new_per_run">("reuse")
  const [jobSilent, setJobSilent] = useState(false)
  const [jobMute, setJobMute] = useState(false)
  const [heartbeatProjectId, setHeartbeatProjectId] = useState("")
  const [heartbeatSessionKey, setHeartbeatSessionKey] = useState("")
  const [heartbeatIntervalMins, setHeartbeatIntervalMins] = useState("60")
  const [heartbeatPrompt, setHeartbeatPrompt] = useState("")
  const feishu = window.synapse?.connectors.feishu

  const refresh = useCallback(async () => {
    if (!feishu) return
    setIsLoading(true)
    try {
      const [nextJobs, nextHeartbeats, nextProjectStatuses] = await Promise.all([
        feishu.listAllScheduledJobs(),
        feishu.listAllHeartbeats(),
        Promise.all(projects.map(async (project) => {
          try {
            return [project.id, await feishu.getStatus(project.id)] as const
          } catch (error) {
            logger.warn("Failed to load project connector status.", { error, projectId: project.id })
            return [project.id, null] as const
          }
        })),
      ])
      setJobs(nextJobs)
      setHeartbeats(nextHeartbeats)
      setProjectStatuses(Object.fromEntries(
        nextProjectStatuses.filter((entry): entry is readonly [string, SynapseFeishuConnectorRuntimeStatus] =>
          entry[1] !== null),
      ))
    } catch (error) {
      logger.error("Failed to load scheduled tasks.", { error })
    } finally {
      setIsLoading(false)
    }
  }, [feishu, projects])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const firstConfiguredProjectId = useMemo(() => (
    projects.find((project) => projectStatuses[project.id]?.configured)?.id ?? projects[0]?.id ?? ""
  ), [projectStatuses, projects])

  useEffect(() => {
    if (!jobProjectId && firstConfiguredProjectId) {
      setJobProjectId(firstConfiguredProjectId)
    }
    if (!heartbeatProjectId && firstConfiguredProjectId) {
      setHeartbeatProjectId(firstConfiguredProjectId)
    }
  }, [firstConfiguredProjectId, heartbeatProjectId, jobProjectId])

  const projectOptions = useMemo(() => {
    const options = new Map(projects.map((project) => [project.id, project.name]))
    for (const item of [...jobs, ...heartbeats]) {
      if (!options.has(item.projectId)) {
        options.set(item.projectId, item.projectName ?? "未匹配项目")
      }
    }
    return [...options.entries()].map(([id, name]) => ({ id, name }))
  }, [heartbeats, jobs, projects])

  const filteredJobs = useMemo(
    () => jobs.filter((job) =>
      matchesProjectFilter(job.projectId, projectFilter) && matchesConnectorFilter(job, connectorFilter)),
    [connectorFilter, jobs, projectFilter],
  )

  const filteredHeartbeats = useMemo(
    () => heartbeats.filter((heartbeat) =>
      matchesProjectFilter(heartbeat.projectId, projectFilter)
      && matchesConnectorFilter(heartbeat, connectorFilter)),
    [connectorFilter, heartbeats, projectFilter],
  )

  const runAction = useCallback(async (
    action: () => Promise<unknown>,
    messages: { loading: string; success: string },
  ) => {
    await promise(action, messages)
    await refresh()
  }, [promise, refresh])

  const selectedJobConnectorId = projectStatuses[jobProjectId]?.connector?.id
  const selectedHeartbeatConnectorId = projectStatuses[heartbeatProjectId]?.connector?.id
  const canCreateJob = Boolean(
    selectedJobConnectorId
    && jobProjectId
    && jobSessionKey.trim()
    && jobCronExpr.trim()
    && jobBody.trim(),
  )
  const canSaveHeartbeat = Boolean(
    selectedHeartbeatConnectorId
    && heartbeatProjectId
    && heartbeatSessionKey.trim()
    && Number(heartbeatIntervalMins) > 0,
  )

  const handleCreateJob = useCallback(async () => {
    if (!feishu || !selectedJobConnectorId || !canCreateJob) return
    await runAction(
      () => feishu.createScheduledJob({
        projectId: jobProjectId,
        connectorId: selectedJobConnectorId,
        sessionKey: jobSessionKey.trim(),
        kind: jobKind,
        cronExpr: jobCronExpr.trim(),
        prompt: jobKind === "prompt" ? jobBody.trim() : undefined,
        exec: jobKind === "exec" ? jobBody.trim() : undefined,
        description: jobDescription.trim() || undefined,
        sessionMode: jobSessionMode,
        silent: jobSilent,
        mute: jobMute,
      }),
      { loading: "正在创建定时任务...", success: "定时任务已创建。" },
    )
    setJobCronExpr("")
    setJobBody("")
    setJobDescription("")
  }, [
    canCreateJob,
    feishu,
    jobBody,
    jobCronExpr,
    jobDescription,
    jobKind,
    jobMute,
    jobProjectId,
    jobSessionKey,
    jobSessionMode,
    jobSilent,
    runAction,
    selectedJobConnectorId,
  ])

  const handleSaveHeartbeat = useCallback(async () => {
    if (!feishu || !selectedHeartbeatConnectorId || !canSaveHeartbeat) return
    await runAction(
      () => feishu.upsertHeartbeat({
        projectId: heartbeatProjectId,
        connectorId: selectedHeartbeatConnectorId,
        sessionKey: heartbeatSessionKey.trim(),
        intervalMins: Number(heartbeatIntervalMins),
        prompt: heartbeatPrompt.trim() || undefined,
      }),
      { loading: "正在保存保活提醒...", success: "保活提醒已保存。" },
    )
  }, [
    canSaveHeartbeat,
    feishu,
    heartbeatIntervalMins,
    heartbeatProjectId,
    heartbeatPrompt,
    heartbeatSessionKey,
    runAction,
    selectedHeartbeatConnectorId,
  ])

  if (!feishu) {
    return (
      <Alert variant="destructive">
        <AlertTitle>飞书不可用</AlertTitle>
        <AlertDescription>当前运行环境没有连接器接口。</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>定时任务</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              disabled={isLoading}
              onClick={() => void refresh()}
              aria-label="刷新定时任务"
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>项目</FieldLabel>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部项目</SelectItem>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>连接器状态</FieldLabel>
              <Select
                value={connectorFilter}
                onValueChange={(value) => setConnectorFilter(value as ConnectorFilter)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="configured">已配置</SelectItem>
                  <SelectItem value="running">运行中</SelectItem>
                  <SelectItem value="error">异常</SelectItem>
                  <SelectItem value="missing">未配置</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <CreateAutomationCard
        canCreateJob={canCreateJob}
        canSaveHeartbeat={canSaveHeartbeat}
        heartbeatIntervalMins={heartbeatIntervalMins}
        heartbeatProjectId={heartbeatProjectId}
        heartbeatPrompt={heartbeatPrompt}
        heartbeatSessionKey={heartbeatSessionKey}
        jobBody={jobBody}
        jobCronExpr={jobCronExpr}
        jobDescription={jobDescription}
        jobKind={jobKind}
        jobMute={jobMute}
        jobProjectId={jobProjectId}
        jobSessionKey={jobSessionKey}
        jobSessionMode={jobSessionMode}
        jobSilent={jobSilent}
        projectOptions={projectOptions}
        projectStatuses={projectStatuses}
        onCreateJob={handleCreateJob}
        onHeartbeatIntervalMinsChange={setHeartbeatIntervalMins}
        onHeartbeatProjectIdChange={setHeartbeatProjectId}
        onHeartbeatPromptChange={setHeartbeatPrompt}
        onHeartbeatSessionKeyChange={setHeartbeatSessionKey}
        onJobBodyChange={setJobBody}
        onJobCronExprChange={setJobCronExpr}
        onJobDescriptionChange={setJobDescription}
        onJobKindChange={setJobKind}
        onJobMuteChange={setJobMute}
        onJobProjectIdChange={setJobProjectId}
        onJobSessionKeyChange={setJobSessionKey}
        onJobSessionModeChange={setJobSessionMode}
        onJobSilentChange={setJobSilent}
        onSaveHeartbeat={handleSaveHeartbeat}
      />

      <ScheduledJobTable
        jobs={filteredJobs}
        isLoading={isLoading}
        onDelete={(job) =>
          runAction(
            () => feishu.deleteScheduledJob({ projectId: job.projectId, id: job.id }),
            { loading: "正在删除定时任务...", success: "定时任务已删除。" },
          )}
        onRun={(job) =>
          runAction(
            () => feishu.runScheduledJob({ projectId: job.projectId, id: job.id }),
            { loading: "正在运行定时任务...", success: "定时任务已触发。" },
          )}
        onToggleEnabled={(job) =>
          runAction(
            () => feishu.setScheduledJobEnabled({
              projectId: job.projectId,
              id: job.id,
              enabled: !job.enabled,
            }),
            { loading: "正在更新定时任务...", success: job.enabled ? "定时任务已停用。" : "定时任务已启用。" },
          )}
        onToggleMuted={(job) =>
          runAction(
            () => feishu.setScheduledJobMuted({
              projectId: job.projectId,
              id: job.id,
              mute: !job.mute,
            }),
            { loading: "正在更新回传状态...", success: job.mute ? "结果回传已开启。" : "结果回传已关闭。" },
          )}
      />

      <HeartbeatTable
        heartbeats={filteredHeartbeats}
        isLoading={isLoading}
        onDelete={(heartbeat) =>
          runAction(
            () => feishu.deleteHeartbeat({ projectId: heartbeat.projectId, id: heartbeat.id }),
            { loading: "正在删除保活提醒...", success: "保活提醒已删除。" },
          )}
        onPause={(heartbeat) =>
          runAction(
            () => feishu.pauseHeartbeat({ projectId: heartbeat.projectId, id: heartbeat.id }),
            { loading: "正在暂停保活提醒...", success: "保活提醒已暂停。" },
          )}
        onResume={(heartbeat) =>
          runAction(
            () => feishu.resumeHeartbeat({ projectId: heartbeat.projectId, id: heartbeat.id }),
            { loading: "正在恢复保活提醒...", success: "保活提醒已恢复。" },
          )}
        onRun={(heartbeat) =>
          runAction(
            () => feishu.runHeartbeat({ projectId: heartbeat.projectId, id: heartbeat.id }),
            { loading: "正在运行保活提醒...", success: "保活提醒已触发。" },
          )}
      />
    </div>
  )
}

function CreateAutomationCard({
  canCreateJob,
  canSaveHeartbeat,
  heartbeatIntervalMins,
  heartbeatProjectId,
  heartbeatPrompt,
  heartbeatSessionKey,
  jobBody,
  jobCronExpr,
  jobDescription,
  jobKind,
  jobMute,
  jobProjectId,
  jobSessionKey,
  jobSessionMode,
  jobSilent,
  projectOptions,
  projectStatuses,
  onCreateJob,
  onHeartbeatIntervalMinsChange,
  onHeartbeatProjectIdChange,
  onHeartbeatPromptChange,
  onHeartbeatSessionKeyChange,
  onJobBodyChange,
  onJobCronExprChange,
  onJobDescriptionChange,
  onJobKindChange,
  onJobMuteChange,
  onJobProjectIdChange,
  onJobSessionKeyChange,
  onJobSessionModeChange,
  onJobSilentChange,
  onSaveHeartbeat,
}: {
  canCreateJob: boolean
  canSaveHeartbeat: boolean
  heartbeatIntervalMins: string
  heartbeatProjectId: string
  heartbeatPrompt: string
  heartbeatSessionKey: string
  jobBody: string
  jobCronExpr: string
  jobDescription: string
  jobKind: "prompt" | "exec"
  jobMute: boolean
  jobProjectId: string
  jobSessionKey: string
  jobSessionMode: "reuse" | "new_per_run"
  jobSilent: boolean
  projectOptions: Array<{ id: string; name: string }>
  projectStatuses: Record<string, SynapseFeishuConnectorRuntimeStatus>
  onCreateJob: () => void
  onHeartbeatIntervalMinsChange: (value: string) => void
  onHeartbeatProjectIdChange: (value: string) => void
  onHeartbeatPromptChange: (value: string) => void
  onHeartbeatSessionKeyChange: (value: string) => void
  onJobBodyChange: (value: string) => void
  onJobCronExprChange: (value: string) => void
  onJobDescriptionChange: (value: string) => void
  onJobKindChange: (value: "prompt" | "exec") => void
  onJobMuteChange: (value: boolean) => void
  onJobProjectIdChange: (value: string) => void
  onJobSessionKeyChange: (value: string) => void
  onJobSessionModeChange: (value: "reuse" | "new_per_run") => void
  onJobSilentChange: (value: boolean) => void
  onSaveHeartbeat: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>新建</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-2">
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">定时执行</span>
            <ProjectConnectorBadge projectId={jobProjectId} projectStatuses={projectStatuses} />
          </div>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>项目</FieldLabel>
                <ProjectSelect
                  projectId={jobProjectId}
                  projectOptions={projectOptions}
                  onProjectIdChange={onJobProjectIdChange}
                />
              </Field>
              <Field>
                <FieldLabel>执行内容</FieldLabel>
                <Select value={jobKind} onValueChange={(value) => onJobKindChange(value as "prompt" | "exec")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prompt">Prompt</SelectItem>
                    <SelectItem value="exec">命令</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scheduled-job-session">会话标识</FieldLabel>
                <Input
                  id="scheduled-job-session"
                  value={jobSessionKey}
                  onChange={(event) => onJobSessionKeyChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scheduled-job-cron">Cron</FieldLabel>
                <Input
                  id="scheduled-job-cron"
                  value={jobCronExpr}
                  onChange={(event) => onJobCronExprChange(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="scheduled-job-body">
                {jobKind === "exec" ? "命令" : "Prompt"}
              </FieldLabel>
              <Textarea
                id="scheduled-job-body"
                value={jobBody}
                onChange={(event) => onJobBodyChange(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scheduled-job-description">名称</FieldLabel>
                <Input
                  id="scheduled-job-description"
                  value={jobDescription}
                  onChange={(event) => onJobDescriptionChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>会话方式</FieldLabel>
                <Select
                  value={jobSessionMode}
                  onValueChange={(value) => onJobSessionModeChange(value as "reuse" | "new_per_run")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reuse">复用会话</SelectItem>
                    <SelectItem value="new_per_run">每次新建会话</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field orientation="horizontal">
                <FieldLabel htmlFor="scheduled-job-silent">隐藏开始提示</FieldLabel>
                <Switch id="scheduled-job-silent" checked={jobSilent} onCheckedChange={onJobSilentChange} />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="scheduled-job-mute">不回传结果</FieldLabel>
                <Switch id="scheduled-job-mute" checked={jobMute} onCheckedChange={onJobMuteChange} />
              </Field>
            </div>
            <div>
              <Button disabled={!canCreateJob} onClick={() => onCreateJob()}>
                <Save data-icon="inline-start" />
                创建任务
              </Button>
            </div>
          </FieldGroup>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">保活提醒</span>
            <ProjectConnectorBadge projectId={heartbeatProjectId} projectStatuses={projectStatuses} />
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel>项目</FieldLabel>
              <ProjectSelect
                projectId={heartbeatProjectId}
                projectOptions={projectOptions}
                onProjectIdChange={onHeartbeatProjectIdChange}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
              <Field>
                <FieldLabel htmlFor="scheduled-heartbeat-session">会话标识</FieldLabel>
                <Input
                  id="scheduled-heartbeat-session"
                  value={heartbeatSessionKey}
                  onChange={(event) => onHeartbeatSessionKeyChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scheduled-heartbeat-interval">间隔分钟</FieldLabel>
                <Input
                  id="scheduled-heartbeat-interval"
                  type="number"
                  min={1}
                  value={heartbeatIntervalMins}
                  onChange={(event) => onHeartbeatIntervalMinsChange(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="scheduled-heartbeat-prompt">检查内容</FieldLabel>
              <Textarea
                id="scheduled-heartbeat-prompt"
                value={heartbeatPrompt}
                onChange={(event) => onHeartbeatPromptChange(event.target.value)}
              />
            </Field>
            <div>
              <Button disabled={!canSaveHeartbeat} onClick={() => onSaveHeartbeat()}>
                <Save data-icon="inline-start" />
                保存保活提醒
              </Button>
            </div>
          </FieldGroup>
        </section>
      </CardContent>
    </Card>
  )
}

function ProjectSelect({
  projectId,
  projectOptions,
  onProjectIdChange,
}: {
  projectId: string
  projectOptions: Array<{ id: string; name: string }>
  onProjectIdChange: (value: string) => void
}) {
  return (
    <Select value={projectId} onValueChange={onProjectIdChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {projectOptions.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ProjectConnectorBadge({
  projectId,
  projectStatuses,
}: {
  projectId: string
  projectStatuses: Record<string, SynapseFeishuConnectorRuntimeStatus>
}) {
  const status = projectStatuses[projectId]
  if (!status?.configured) {
    return <Badge variant="secondary">未配置</Badge>
  }
  return (
    <Badge variant={connectorStatusVariant(status.connector?.status)}>
      {statusLabel(status.connector?.status)}
    </Badge>
  )
}

function ScheduledJobTable({
  jobs,
  isLoading,
  onDelete,
  onRun,
  onToggleEnabled,
  onToggleMuted,
}: {
  jobs: readonly SynapseFeishuScheduledJobWithProject[]
  isLoading: boolean
  onDelete: (job: SynapseFeishuScheduledJobWithProject) => void
  onRun: (job: SynapseFeishuScheduledJobWithProject) => void
  onToggleEnabled: (job: SynapseFeishuScheduledJobWithProject) => void
  onToggleMuted: (job: SynapseFeishuScheduledJobWithProject) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>定时执行</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead>任务</TableHead>
              <TableHead>会话</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>下次执行</TableHead>
              <TableHead>上次执行</TableHead>
              <TableHead className="w-36 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  {isLoading ? "加载中..." : "暂无定时任务"}
                </TableCell>
              </TableRow>
            ) : jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>{job.projectName ?? "未匹配项目"}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-xs">{job.description ?? job.id}</span>
                    <span className="text-xs text-muted-foreground">{job.kind === "exec" ? "命令" : "Prompt"}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{job.sessionKey}</TableCell>
                <TableCell>
                  <AutomationStatusBadges item={job} enabled={job.enabled} />
                </TableCell>
                <TableCell className="font-mono text-xs">{formatOptionalDate(job.nextRunAt)}</TableCell>
                <TableCell className="font-mono text-xs">{formatOptionalDate(job.lastRunAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onRun(job)} aria-label="立即运行">
                      <Play />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onToggleEnabled(job)} aria-label="启停任务">
                      {job.enabled ? <Pause /> : <Play />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onToggleMuted(job)} aria-label="切换结果回传">
                      <VolumeX />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(job)} aria-label="删除">
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function HeartbeatTable({
  heartbeats,
  isLoading,
  onDelete,
  onPause,
  onResume,
  onRun,
}: {
  heartbeats: readonly SynapseFeishuHeartbeatWithProject[]
  isLoading: boolean
  onDelete: (heartbeat: SynapseFeishuHeartbeatWithProject) => void
  onPause: (heartbeat: SynapseFeishuHeartbeatWithProject) => void
  onResume: (heartbeat: SynapseFeishuHeartbeatWithProject) => void
  onRun: (heartbeat: SynapseFeishuHeartbeatWithProject) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>保活提醒</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead>会话</TableHead>
              <TableHead className="text-right">间隔</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>下次执行</TableHead>
              <TableHead>上次执行</TableHead>
              <TableHead className="w-36 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {heartbeats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  {isLoading ? "加载中..." : "暂无保活提醒"}
                </TableCell>
              </TableRow>
            ) : heartbeats.map((heartbeat) => (
              <TableRow key={heartbeat.id}>
                <TableCell>{heartbeat.projectName ?? "未匹配项目"}</TableCell>
                <TableCell className="font-mono text-xs">{heartbeat.sessionKey}</TableCell>
                <TableCell className="text-right font-mono text-xs">{heartbeat.intervalMins}</TableCell>
                <TableCell>
                  <AutomationStatusBadges
                    item={heartbeat}
                    enabled={heartbeat.enabled && !heartbeat.paused}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{formatOptionalDate(heartbeat.nextRunAt)}</TableCell>
                <TableCell className="font-mono text-xs">{formatOptionalDate(heartbeat.lastRunAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onRun(heartbeat)} aria-label="立即运行保活提醒">
                      <RotateCcw />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => heartbeat.paused ? onResume(heartbeat) : onPause(heartbeat)}
                      aria-label={heartbeat.paused ? "恢复保活提醒" : "暂停保活提醒"}
                    >
                      {heartbeat.paused ? <Play /> : <Pause />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(heartbeat)} aria-label="删除">
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AutomationStatusBadges({
  enabled,
  item,
}: {
  enabled: boolean
  item: {
    connectorConfigured: boolean
    connectorRunning: boolean
    connectorStatus?: SynapseConnectorStatus
    mute?: boolean
    silent?: boolean
  }
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={enabled ? "default" : "secondary"}>
        {enabled ? "启用" : "停用"}
      </Badge>
      <Badge variant={connectorStatusVariant(item.connectorStatus)}>
        {item.connectorConfigured ? statusLabel(item.connectorStatus) : "未配置"}
      </Badge>
      {item.connectorRunning ? <Badge variant="outline">运行中</Badge> : null}
      {item.mute ? <Badge variant="outline">不回传</Badge> : null}
      {item.silent ? <Badge variant="outline">隐藏提示</Badge> : null}
    </div>
  )
}

function matchesProjectFilter(projectId: string, projectFilter: string): boolean {
  return projectFilter === "all" || projectId === projectFilter
}

function matchesConnectorFilter(
  item: { connectorConfigured: boolean; connectorRunning: boolean; connectorStatus?: SynapseConnectorStatus },
  connectorFilter: ConnectorFilter,
): boolean {
  switch (connectorFilter) {
    case "configured":
      return item.connectorConfigured
    case "running":
      return item.connectorRunning
    case "error":
      return item.connectorStatus === "error"
    case "missing":
      return !item.connectorConfigured
    default:
      return true
  }
}

function connectorStatusVariant(status: SynapseConnectorStatus | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (status === "error") return "destructive"
  if (status === "connected") return "default"
  if (!status || status === "disabled") return "secondary"
  return "outline"
}

function statusLabel(status: SynapseConnectorStatus | undefined): string {
  switch (status) {
    case "connecting":
      return "连接中"
    case "connected":
      return "已连接"
    case "degraded":
      return "异常"
    case "error":
      return "失败"
    default:
      return "未连接"
  }
}

function formatOptionalDate(value: string | undefined): string {
  return value ? formatDateTime(value) : "-"
}

export { ScheduledTasksPanel }
