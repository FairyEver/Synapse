import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FolderOpen,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  VolumeX,
} from "lucide-react"
import QRCode from "qrcode"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAppNotifications } from "@/app-shell/notifications"
import type {
  SynapseFeishuConnectorRuntimeStatus,
  SynapseFeishuHeartbeat,
  SynapseFeishuScheduledJob,
  SynapseFeishuSetupBeginResult,
  SynapseFeishuSetupPollResult,
  SynapseFeishuWorkspaceBinding,
  SynapseFeishuWorkspaceBindingsSummary,
  SynapseFeishuWorkspaceConfig,
} from "@/types/connectors"

type FeishuConnectorPanelProps = {
  projectId: string | null
  repositoryName?: string
  repositoryPath?: string
}

type SetupState = SynapseFeishuSetupBeginResult & {
  poll?: SynapseFeishuSetupPollResult
}

function FeishuConnectorPanel({
  projectId,
  repositoryName,
  repositoryPath,
}: FeishuConnectorPanelProps) {
  const { promise } = useAppNotifications()
  const [status, setStatus] = useState<SynapseFeishuConnectorRuntimeStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [manualAppId, setManualAppId] = useState("")
  const [manualAppSecret, setManualAppSecret] = useState("")
  const [manualOwnerOpenId, setManualOwnerOpenId] = useState("")
  const [workspaceConfig, setWorkspaceConfig] = useState<SynapseFeishuWorkspaceConfig>({
    enabled: false,
    autoBindByChannelName: true,
  })
  const [workspaceBindings, setWorkspaceBindings] =
    useState<SynapseFeishuWorkspaceBindingsSummary>({ project: [], shared: [] })
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [scheduledJobs, setScheduledJobs] = useState<SynapseFeishuScheduledJob[]>([])
  const [heartbeats, setHeartbeats] = useState<SynapseFeishuHeartbeat[]>([])
  const [isLoadingAutomation, setIsLoadingAutomation] = useState(false)
  const [jobKind, setJobKind] = useState<"prompt" | "exec">("prompt")
  const [jobSessionKey, setJobSessionKey] = useState("")
  const [jobCronExpr, setJobCronExpr] = useState("")
  const [jobBody, setJobBody] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [jobSessionMode, setJobSessionMode] = useState<"reuse" | "new_per_run">("reuse")
  const [jobSilent, setJobSilent] = useState(false)
  const [jobMute, setJobMute] = useState(false)
  const [heartbeatSessionKey, setHeartbeatSessionKey] = useState("")
  const [heartbeatIntervalMins, setHeartbeatIntervalMins] = useState("60")
  const [heartbeatPrompt, setHeartbeatPrompt] = useState("")

  const feishu = window.synapse?.connectors.feishu

  const refreshStatus = useCallback(async () => {
    if (!projectId || !feishu) return
    setIsLoadingStatus(true)
    try {
      setStatus(await feishu.getStatus(projectId))
    } finally {
      setIsLoadingStatus(false)
    }
  }, [feishu, projectId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const refreshWorkspace = useCallback(async () => {
    if (!projectId || !feishu) return
    setIsLoadingWorkspace(true)
    try {
      const [config, bindings] = await Promise.all([
        feishu.getWorkspaceConfig(projectId),
        feishu.listWorkspaceBindings(projectId),
      ])
      setWorkspaceConfig(config)
      setWorkspaceBindings(bindings)
    } finally {
      setIsLoadingWorkspace(false)
    }
  }, [feishu, projectId])

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  const refreshAutomation = useCallback(async () => {
    if (!projectId || !feishu) return
    setIsLoadingAutomation(true)
    try {
      const [jobs, heartbeatEntries] = await Promise.all([
        feishu.listScheduledJobs(projectId),
        feishu.listHeartbeats(projectId),
      ])
      setScheduledJobs(jobs)
      setHeartbeats(heartbeatEntries)
    } finally {
      setIsLoadingAutomation(false)
    }
  }, [feishu, projectId])

  useEffect(() => {
    void refreshAutomation()
  }, [refreshAutomation])

  useEffect(() => {
    if (!setup?.qrUrl) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(setup.qrUrl, { margin: 1 }).then((value) => {
      if (!cancelled) setQrDataUrl(value)
    }).catch(() => {
      if (!cancelled) setQrDataUrl(null)
    })
    return () => {
      cancelled = true
    }
  }, [setup?.qrUrl])

  useEffect(() => {
    if (!feishu || !setup) return
    if (setup.poll && !["pending", "slow_down"].includes(setup.poll.status)) return

    let cancelled = false
    const intervalMs = (setup.poll?.intervalSeconds ?? setup.intervalSeconds) * 1000
    const timer = window.setInterval(() => {
      void feishu.pollSetup(setup.setupId).then((poll) => {
        if (cancelled) return
        setSetup((current) => current?.setupId === setup.setupId ? { ...current, poll } : current)
      })
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [feishu, setup])

  const statusBadge = useMemo(() => {
    const connectorStatus = status?.connector?.status ?? "disabled"
    const label = statusLabel(connectorStatus)
    const variant = connectorStatus === "error"
      ? "destructive"
      : connectorStatus === "connected"
        ? "default"
        : connectorStatus === "disabled"
          ? "secondary"
          : "outline"
    return <Badge variant={variant}>{label}</Badge>
  }, [status])

  const handleBeginSetup = useCallback(async () => {
    if (!projectId || !feishu) return
    const result = await promise(
      () => feishu.beginSetup(projectId),
      {
        loading: "正在创建二维码...",
        success: "二维码已创建。",
      },
    )
    setSetup(result)
  }, [feishu, projectId, promise])

  const handleSaveSetup = useCallback(async () => {
    if (!setup || !feishu) return
    await promise(
      () => feishu.saveSetup(setup.setupId),
      {
        loading: "正在保存飞书连接器...",
        success: "飞书已保存。",
      },
    )
    setSetup(null)
    await refreshStatus()
  }, [feishu, promise, refreshStatus, setup])

  const handleSaveManual = useCallback(async () => {
    if (!projectId || !feishu) return
    await promise(
      () => feishu.saveManualCredentials({
        projectId,
        appId: manualAppId,
        appSecret: manualAppSecret,
        ownerOpenId: manualOwnerOpenId || undefined,
      }),
      {
        loading: "正在保存飞书连接器...",
        success: "飞书已保存。",
      },
    )
    setManualAppSecret("")
    await refreshStatus()
  }, [
    feishu,
    manualAppId,
    manualAppSecret,
    manualOwnerOpenId,
    projectId,
    promise,
    refreshStatus,
  ])

  const handleStart = useCallback(async () => {
    if (!projectId || !feishu) return
    const result = await promise(
      () => feishu.start(projectId),
      {
        loading: "正在连接飞书...",
        success: "飞书已连接。",
      },
    )
    setStatus(result)
  }, [feishu, projectId, promise])

  const handleStop = useCallback(async () => {
    if (!projectId || !feishu) return
    const result = await promise(
      () => feishu.stop(projectId),
      {
        loading: "正在断开飞书...",
        success: "飞书已断开。",
      },
    )
    setStatus(result)
  }, [feishu, projectId, promise])

  const handleChooseBaseDir = useCallback(async () => {
    const selectedPath = await window.synapse?.repository.chooseDirectory()
    if (selectedPath) {
      setWorkspaceConfig((current) => ({ ...current, baseDir: selectedPath }))
    }
  }, [])

  const handleSaveWorkspaceConfig = useCallback(async () => {
    if (!projectId || !feishu) return
    const saved = await promise(
      () => feishu.updateWorkspaceConfig({
        projectId,
        enabled: workspaceConfig.enabled,
        baseDir: workspaceConfig.baseDir,
        autoBindByChannelName: workspaceConfig.autoBindByChannelName,
        idleTimeoutMs: workspaceConfig.idleTimeoutMs,
      }),
      {
        loading: "正在保存目录规则...",
        success: "目录规则已保存。",
      },
    )
    setWorkspaceConfig(saved)
    await refreshWorkspace()
  }, [feishu, projectId, promise, refreshWorkspace, workspaceConfig])

  const handleUnbindWorkspace = useCallback(async (
    binding: SynapseFeishuWorkspaceBinding,
  ) => {
    if (!projectId || !feishu) return
    await promise(
      () => feishu.unbindWorkspaceBinding({
        projectId,
        scope: binding.scope,
        channelKey: binding.channelKey,
      }),
      {
        loading: "正在解绑...",
        success: "已解绑。",
      },
    )
    await refreshWorkspace()
  }, [feishu, projectId, promise, refreshWorkspace])

  const handleCreateJob = useCallback(async () => {
    const connectorId = status?.connector?.id
    if (!projectId || !feishu || !connectorId) return
    await promise(
      () => feishu.createScheduledJob({
        projectId,
        connectorId,
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
      {
        loading: "正在创建定时任务...",
        success: "定时任务已创建。",
      },
    )
    setJobCronExpr("")
    setJobBody("")
    setJobDescription("")
    await refreshAutomation()
  }, [
    feishu,
    jobBody,
    jobCronExpr,
    jobDescription,
    jobKind,
    jobMute,
    jobSessionKey,
    jobSessionMode,
    jobSilent,
    projectId,
    promise,
    refreshAutomation,
    status?.connector?.id,
  ])

  const handleToggleJobEnabled = useCallback(async (
    job: SynapseFeishuScheduledJob,
  ) => {
    if (!projectId || !feishu) return
    await feishu.setScheduledJobEnabled({ projectId, id: job.id, enabled: !job.enabled })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleToggleJobMuted = useCallback(async (
    job: SynapseFeishuScheduledJob,
  ) => {
    if (!projectId || !feishu) return
    await feishu.setScheduledJobMuted({ projectId, id: job.id, mute: !job.mute })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleDeleteJob = useCallback(async (job: SynapseFeishuScheduledJob) => {
    if (!projectId || !feishu) return
    await feishu.deleteScheduledJob({ projectId, id: job.id })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleRunJob = useCallback(async (job: SynapseFeishuScheduledJob) => {
    if (!projectId || !feishu) return
    await feishu.runScheduledJob({ projectId, id: job.id })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleSaveHeartbeat = useCallback(async () => {
    const connectorId = status?.connector?.id
    const intervalMins = Number(heartbeatIntervalMins)
    if (!projectId || !feishu || !connectorId || !Number.isInteger(intervalMins)) return
    await promise(
      () => feishu.upsertHeartbeat({
        projectId,
        connectorId,
        sessionKey: heartbeatSessionKey.trim(),
        intervalMins,
        prompt: heartbeatPrompt.trim() || undefined,
      }),
      {
        loading: "正在保存保活提醒...",
        success: "保活提醒已保存。",
      },
    )
    await refreshAutomation()
  }, [
    feishu,
    heartbeatIntervalMins,
    heartbeatPrompt,
    heartbeatSessionKey,
    projectId,
    promise,
    refreshAutomation,
    status?.connector?.id,
  ])

  const handlePauseHeartbeat = useCallback(async (heartbeat: SynapseFeishuHeartbeat) => {
    if (!projectId || !feishu) return
    await feishu.pauseHeartbeat({ projectId, id: heartbeat.id })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleResumeHeartbeat = useCallback(async (heartbeat: SynapseFeishuHeartbeat) => {
    if (!projectId || !feishu) return
    await feishu.resumeHeartbeat({ projectId, id: heartbeat.id })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const handleRunHeartbeat = useCallback(async (heartbeat: SynapseFeishuHeartbeat) => {
    if (!projectId || !feishu) return
    await feishu.runHeartbeat({ projectId, id: heartbeat.id })
    await refreshAutomation()
  }, [feishu, projectId, refreshAutomation])

  const connector = status?.connector
  const workspaceDirectoryEnabled = workspaceConfig.enabled
  const workspaceBaseDirRequired = workspaceDirectoryEnabled && !workspaceConfig.baseDir?.trim()

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>飞书连接器</CardTitle>
          <CardDescription>连接器设置跟随当前仓库。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">请先选择仓库。</p>
        </CardContent>
      </Card>
    )
  }

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
          <CardTitle className="flex items-center gap-2">
            飞书连接器
            {statusBadge}
          </CardTitle>
          <CardDescription>
            接入飞书消息，让当前仓库可以在飞书中启动会话、任务和提醒。
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              disabled={isLoadingStatus}
              onClick={() => void refreshStatus()}
              aria-label="刷新连接状态"
            >
              <RefreshCw className={isLoadingStatus ? "animate-spin" : undefined} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ConnectorDetail label="App ID" value={connector?.appId ?? "未配置"} />
            <ConnectorDetail label="当前仓库" value={repositoryName ?? "未选择"} />
            <ConnectorDetail label="默认运行目录" value={repositoryPath ?? "未选择"} wrap />
            <ConnectorDetail label="运行状态" value={status?.running ? "已连接" : "未连接"} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={status?.running || !status?.configured}
              onClick={() => void handleStart()}
            >
              <Play data-icon="inline-start" />
              连接
            </Button>
            <Button
              variant="outline"
              disabled={!status?.running}
              onClick={() => void handleStop()}
            >
              <Square data-icon="inline-start" />
              断开
            </Button>
          </div>

          {connector?.lastError ? (
            <Alert variant="destructive">
              <AlertTitle>连接失败</AlertTitle>
              <AlertDescription>{connector.lastError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>连接凭据</CardTitle>
          <CardDescription>保存飞书应用凭据后，连接器才能收发消息。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
          <div className="flex flex-col gap-6">
            <FieldGroup>
              <Field>
                <FieldLabel>扫码授权</FieldLabel>
                <FieldDescription>用开发者账号完成一次性授权。</FieldDescription>
                <div>
                  <Button
                    variant="outline"
                    onClick={() => void handleBeginSetup()}
                  >
                    <QrCode data-icon="inline-start" />
                    创建二维码
                  </Button>
                </div>
              </Field>
              {setup?.poll?.status === "completed" ? (
                <Button onClick={() => void handleSaveSetup()}>
                  <Save data-icon="inline-start" />
                  保存授权
                </Button>
              ) : null}
              {setup?.poll?.message ? (
                <p className="text-sm text-muted-foreground">{setup.poll.message}</p>
              ) : null}
            </FieldGroup>

            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="feishu-app-id">App ID</FieldLabel>
                  <Input
                    id="feishu-app-id"
                    value={manualAppId}
                    onChange={(event) => setManualAppId(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="feishu-app-secret">App Secret</FieldLabel>
                  <Input
                    id="feishu-app-secret"
                    type="password"
                    value={manualAppSecret}
                    onChange={(event) => setManualAppSecret(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="feishu-owner-open-id">Owner Open ID</FieldLabel>
                  <Input
                    id="feishu-owner-open-id"
                    value={manualOwnerOpenId}
                    onChange={(event) => setManualOwnerOpenId(event.target.value)}
                  />
                </Field>
              </div>
              <div>
                <Button
                  disabled={!manualAppId.trim() || !manualAppSecret.trim()}
                  onClick={() => void handleSaveManual()}
                >
                  <Save data-icon="inline-start" />
                  保存凭据
                </Button>
              </div>
            </FieldGroup>
          </div>

          <div className="flex min-h-56 items-center justify-center rounded-lg border border-border bg-background p-3">
            {qrDataUrl ? (
              <img
                className="size-48"
                src={qrDataUrl}
                alt="飞书授权二维码"
              />
            ) : (
              <p className="text-sm text-muted-foreground">先创建二维码</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>频道目录</CardTitle>
          <CardDescription>按飞书频道选择本地运行目录。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">目录规则</span>
              <Badge variant={workspaceDirectoryEnabled ? "default" : "secondary"}>
                {workspaceDirectoryEnabled ? "启用" : "未启用"}
              </Badge>
            </div>
            <FieldGroup>
              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="feishu-workspace-enabled">启用频道目录</FieldLabel>
                  <FieldDescription>开启后选择本地根目录。</FieldDescription>
                </div>
                <Switch
                  id="feishu-workspace-enabled"
                  checked={workspaceDirectoryEnabled}
                  onCheckedChange={(enabled) =>
                    setWorkspaceConfig((current) => ({ ...current, enabled }))}
                />
              </Field>
              <Field data-disabled={!workspaceDirectoryEnabled || undefined}>
                <FieldLabel htmlFor="feishu-workspace-base-dir">本地根目录</FieldLabel>
                <FieldDescription>选择包含频道同名文件夹的父目录。</FieldDescription>
                <div className="flex gap-2">
                  <Input
                    id="feishu-workspace-base-dir"
                    value={workspaceConfig.baseDir ?? ""}
                    disabled={!workspaceDirectoryEnabled}
                    onChange={(event) =>
                      setWorkspaceConfig((current) => ({
                        ...current,
                        baseDir: event.target.value,
                      }))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!workspaceDirectoryEnabled}
                    onClick={() => void handleChooseBaseDir()}
                    aria-label="选择目录"
                  >
                    <FolderOpen />
                  </Button>
                </div>
              </Field>
              <Field orientation="horizontal" data-disabled={!workspaceDirectoryEnabled || undefined}>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="feishu-workspace-auto-bind">按频道名自动绑定</FieldLabel>
                  <FieldDescription>频道名和文件夹名相同时自动绑定。</FieldDescription>
                </div>
                <Switch
                  id="feishu-workspace-auto-bind"
                  checked={workspaceConfig.autoBindByChannelName ?? true}
                  disabled={!workspaceDirectoryEnabled}
                  onCheckedChange={(autoBindByChannelName) =>
                    setWorkspaceConfig((current) => ({ ...current, autoBindByChannelName }))}
                />
              </Field>
              <div>
                <Button
                  disabled={workspaceBaseDirRequired}
                  onClick={() => void handleSaveWorkspaceConfig()}
                >
                  <Save data-icon="inline-start" />
                  保存目录规则
                </Button>
              </div>
            </FieldGroup>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">绑定结果</span>
              <Badge variant="secondary">
                {workspaceBindings.project.length + workspaceBindings.shared.length}
              </Badge>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <WorkspaceBindingTable
                title="当前仓库绑定"
                bindings={workspaceBindings.project}
                isLoading={isLoadingWorkspace}
                onUnbind={handleUnbindWorkspace}
              />
              <WorkspaceBindingTable
                title="共享绑定"
                bindings={workspaceBindings.shared}
                isLoading={isLoadingWorkspace}
                onUnbind={handleUnbindWorkspace}
              />
            </div>
          </section>
        </CardContent>
      </Card>

      <AutomationSection
        connectorId={status?.connector?.id}
        jobs={scheduledJobs}
        heartbeats={heartbeats}
        isLoading={isLoadingAutomation}
        jobKind={jobKind}
        jobSessionKey={jobSessionKey}
        jobCronExpr={jobCronExpr}
        jobBody={jobBody}
        jobDescription={jobDescription}
        jobSessionMode={jobSessionMode}
        jobSilent={jobSilent}
        jobMute={jobMute}
        heartbeatSessionKey={heartbeatSessionKey}
        heartbeatIntervalMins={heartbeatIntervalMins}
        heartbeatPrompt={heartbeatPrompt}
        onJobKindChange={setJobKind}
        onJobSessionKeyChange={setJobSessionKey}
        onJobCronExprChange={setJobCronExpr}
        onJobBodyChange={setJobBody}
        onJobDescriptionChange={setJobDescription}
        onJobSessionModeChange={setJobSessionMode}
        onJobSilentChange={setJobSilent}
        onJobMuteChange={setJobMute}
        onCreateJob={handleCreateJob}
        onToggleJobEnabled={handleToggleJobEnabled}
        onToggleJobMuted={handleToggleJobMuted}
        onDeleteJob={handleDeleteJob}
        onRunJob={handleRunJob}
        onHeartbeatSessionKeyChange={setHeartbeatSessionKey}
        onHeartbeatIntervalMinsChange={setHeartbeatIntervalMins}
        onHeartbeatPromptChange={setHeartbeatPrompt}
        onSaveHeartbeat={handleSaveHeartbeat}
        onPauseHeartbeat={handlePauseHeartbeat}
        onResumeHeartbeat={handleResumeHeartbeat}
        onRunHeartbeat={handleRunHeartbeat}
        onRefresh={refreshAutomation}
      />
    </div>
  )
}

function ConnectorDetail({
  label,
  value,
  wrap = false,
}: {
  label: string
  value: string
  wrap?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={wrap ? "break-all font-mono text-xs" : "truncate text-sm"}>{value}</span>
    </div>
  )
}

function WorkspaceBindingTable({
  title,
  bindings,
  isLoading,
  onUnbind,
}: {
  title: string
  bindings: readonly SynapseFeishuWorkspaceBinding[]
  isLoading: boolean
  onUnbind: (binding: SynapseFeishuWorkspaceBinding) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary">{bindings.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>频道</TableHead>
            <TableHead>目录</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {bindings.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                {isLoading ? "加载中..." : "暂无绑定"}
              </TableCell>
            </TableRow>
          ) : bindings.map((binding) => (
            <TableRow key={binding.id}>
              <TableCell>{binding.channelName ?? binding.channelKey}</TableCell>
              <TableCell className="font-mono text-xs">{binding.workspacePath}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onUnbind(binding)}
                  aria-label="解绑"
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AutomationSection({
  connectorId,
  jobs,
  heartbeats,
  isLoading,
  jobKind,
  jobSessionKey,
  jobCronExpr,
  jobBody,
  jobDescription,
  jobSessionMode,
  jobSilent,
  jobMute,
  heartbeatSessionKey,
  heartbeatIntervalMins,
  heartbeatPrompt,
  onJobKindChange,
  onJobSessionKeyChange,
  onJobCronExprChange,
  onJobBodyChange,
  onJobDescriptionChange,
  onJobSessionModeChange,
  onJobSilentChange,
  onJobMuteChange,
  onCreateJob,
  onToggleJobEnabled,
  onToggleJobMuted,
  onDeleteJob,
  onRunJob,
  onHeartbeatSessionKeyChange,
  onHeartbeatIntervalMinsChange,
  onHeartbeatPromptChange,
  onSaveHeartbeat,
  onPauseHeartbeat,
  onResumeHeartbeat,
  onRunHeartbeat,
  onRefresh,
}: {
  connectorId?: string
  jobs: readonly SynapseFeishuScheduledJob[]
  heartbeats: readonly SynapseFeishuHeartbeat[]
  isLoading: boolean
  jobKind: "prompt" | "exec"
  jobSessionKey: string
  jobCronExpr: string
  jobBody: string
  jobDescription: string
  jobSessionMode: "reuse" | "new_per_run"
  jobSilent: boolean
  jobMute: boolean
  heartbeatSessionKey: string
  heartbeatIntervalMins: string
  heartbeatPrompt: string
  onJobKindChange: (value: "prompt" | "exec") => void
  onJobSessionKeyChange: (value: string) => void
  onJobCronExprChange: (value: string) => void
  onJobBodyChange: (value: string) => void
  onJobDescriptionChange: (value: string) => void
  onJobSessionModeChange: (value: "reuse" | "new_per_run") => void
  onJobSilentChange: (value: boolean) => void
  onJobMuteChange: (value: boolean) => void
  onCreateJob: () => void
  onToggleJobEnabled: (job: SynapseFeishuScheduledJob) => void
  onToggleJobMuted: (job: SynapseFeishuScheduledJob) => void
  onDeleteJob: (job: SynapseFeishuScheduledJob) => void
  onRunJob: (job: SynapseFeishuScheduledJob) => void
  onHeartbeatSessionKeyChange: (value: string) => void
  onHeartbeatIntervalMinsChange: (value: string) => void
  onHeartbeatPromptChange: (value: string) => void
  onSaveHeartbeat: () => void
  onPauseHeartbeat: (heartbeat: SynapseFeishuHeartbeat) => void
  onResumeHeartbeat: (heartbeat: SynapseFeishuHeartbeat) => void
  onRunHeartbeat: (heartbeat: SynapseFeishuHeartbeat) => void
  onRefresh: () => void
}) {
  const canCreateJob = Boolean(connectorId && jobSessionKey.trim() && jobCronExpr.trim() && jobBody.trim())
  const canSaveHeartbeat = Boolean(connectorId && heartbeatSessionKey.trim() && Number(heartbeatIntervalMins) > 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>自动任务</CardTitle>
        <CardDescription>
          按时间在飞书会话里执行 Prompt 或命令；保活提醒用于定期检查状态。
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            disabled={isLoading}
            onClick={() => onRefresh()}
            aria-label="刷新自动任务"
          >
            <RefreshCw className={isLoading ? "animate-spin" : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">定时执行</span>
            <Badge variant="secondary">{jobs.length}</Badge>
          </div>

          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
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
              <Field>
                <FieldLabel htmlFor="feishu-cron-session">会话标识</FieldLabel>
                <Input
                  id="feishu-cron-session"
                  value={jobSessionKey}
                  onChange={(event) => onJobSessionKeyChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="feishu-cron-expr">执行时间</FieldLabel>
                <Input
                  id="feishu-cron-expr"
                  value={jobCronExpr}
                  onChange={(event) => onJobCronExprChange(event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <Field>
                <FieldLabel htmlFor="feishu-cron-body">
                  {jobKind === "exec" ? "命令" : "Prompt"}
                </FieldLabel>
                {jobKind === "exec" ? (
                  <FieldDescription>命令会在本机执行，请只给可信管理员使用。</FieldDescription>
                ) : null}
                <Textarea
                  id="feishu-cron-body"
                  value={jobBody}
                  onChange={(event) => onJobBodyChange(event.target.value)}
                />
              </Field>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="feishu-cron-desc">名称</FieldLabel>
                  <Input
                    id="feishu-cron-desc"
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
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="feishu-cron-silent">隐藏开始提示</FieldLabel>
                  <Switch id="feishu-cron-silent" checked={jobSilent} onCheckedChange={onJobSilentChange} />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="feishu-cron-mute">不回传结果</FieldLabel>
                  <Switch id="feishu-cron-mute" checked={jobMute} onCheckedChange={onJobMuteChange} />
                </Field>
              </FieldGroup>
            </div>
            <div>
              <Button disabled={!canCreateJob} onClick={() => onCreateJob()}>
                <Save data-icon="inline-start" />
                创建任务
              </Button>
            </div>
          </FieldGroup>

          <ScheduledJobTable
            jobs={jobs}
            isLoading={isLoading}
            onToggleEnabled={onToggleJobEnabled}
            onToggleMuted={onToggleJobMuted}
            onDelete={onDeleteJob}
            onRun={onRunJob}
          />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">保活提醒</span>
            <Badge variant="secondary">{heartbeats.length}</Badge>
          </div>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
              <Field>
                <FieldLabel htmlFor="feishu-heartbeat-session">会话标识</FieldLabel>
                <Input
                  id="feishu-heartbeat-session"
                  value={heartbeatSessionKey}
                  onChange={(event) => onHeartbeatSessionKeyChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="feishu-heartbeat-interval">间隔分钟</FieldLabel>
                <Input
                  id="feishu-heartbeat-interval"
                  type="number"
                  min={1}
                  value={heartbeatIntervalMins}
                  onChange={(event) => onHeartbeatIntervalMinsChange(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="feishu-heartbeat-prompt">检查内容</FieldLabel>
              <FieldDescription>留空时使用默认检查内容。</FieldDescription>
              <Textarea
                id="feishu-heartbeat-prompt"
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

          <HeartbeatTable
            heartbeats={heartbeats}
            isLoading={isLoading}
            onPause={onPauseHeartbeat}
            onResume={onResumeHeartbeat}
            onRun={onRunHeartbeat}
          />
        </section>
      </CardContent>
    </Card>
  )
}

function ScheduledJobTable({
  jobs,
  isLoading,
  onToggleEnabled,
  onToggleMuted,
  onDelete,
  onRun,
}: {
  jobs: readonly SynapseFeishuScheduledJob[]
  isLoading: boolean
  onToggleEnabled: (job: SynapseFeishuScheduledJob) => void
  onToggleMuted: (job: SynapseFeishuScheduledJob) => void
  onDelete: (job: SynapseFeishuScheduledJob) => void
  onRun: (job: SynapseFeishuScheduledJob) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>任务</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>下次执行</TableHead>
          <TableHead>上次执行</TableHead>
          <TableHead className="w-36 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground">
              {isLoading ? "加载中..." : "暂无定时任务"}
            </TableCell>
          </TableRow>
        ) : jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-mono text-xs">{job.description ?? job.id}</TableCell>
            <TableCell>{job.kind === "exec" ? "命令" : "Prompt"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <Badge variant={job.enabled ? "default" : "secondary"}>
                  {job.enabled ? "启用" : "禁用"}
                </Badge>
                {job.mute ? <Badge variant="outline">不回传</Badge> : null}
                {job.silent ? <Badge variant="outline">隐藏提示</Badge> : null}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{formatDate(job.nextRunAt)}</TableCell>
            <TableCell className="font-mono text-xs">{formatDate(job.lastRunAt)}</TableCell>
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
  )
}

function HeartbeatTable({
  heartbeats,
  isLoading,
  onPause,
  onResume,
  onRun,
}: {
  heartbeats: readonly SynapseFeishuHeartbeat[]
  isLoading: boolean
  onPause: (heartbeat: SynapseFeishuHeartbeat) => void
  onResume: (heartbeat: SynapseFeishuHeartbeat) => void
  onRun: (heartbeat: SynapseFeishuHeartbeat) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>会话</TableHead>
          <TableHead className="text-right">间隔</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>下次执行</TableHead>
          <TableHead className="w-28 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {heartbeats.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-muted-foreground">
              {isLoading ? "加载中..." : "暂无保活提醒"}
            </TableCell>
          </TableRow>
        ) : heartbeats.map((heartbeat) => (
          <TableRow key={heartbeat.id}>
            <TableCell className="font-mono text-xs">{heartbeat.sessionKey}</TableCell>
            <TableCell className="text-right font-mono text-xs">{heartbeat.intervalMins}</TableCell>
            <TableCell>{heartbeat.paused || !heartbeat.enabled ? "暂停" : "启用"}</TableCell>
            <TableCell className="font-mono text-xs">{formatDate(heartbeat.nextRunAt)}</TableCell>
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
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function statusLabel(status: string): string {
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

function formatDate(value: string | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export { FeishuConnectorPanel }
