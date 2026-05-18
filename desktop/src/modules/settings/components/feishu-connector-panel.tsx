import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import {
  FolderOpen,
  Play,
  QrCode,
  RefreshCw,
  Save,
  Square,
  Trash2,
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useAppNotifications } from "@/app-shell/notifications"
import type {
  SynapseFeishuConnectorRuntimeStatus,
  SynapseFeishuSetupBeginResult,
  SynapseFeishuSetupPollResult,
  SynapseFeishuWorkspaceBinding,
  SynapseFeishuWorkspaceBindingsSummary,
  SynapseFeishuWorkspaceConfig,
} from "@/types/connectors"

type FeishuConnectorPanelProps = {
  projectId: string | null
  projectName?: string
  projectPath?: string
  initialTab?: FeishuConnectorTab
  variant?: "setup" | "config"
  onConnectorChange?: () => void
}

type FeishuConnectorTab = "status" | "credentials" | "workspace"

type SetupState = SynapseFeishuSetupBeginResult & {
  poll?: SynapseFeishuSetupPollResult
}

function FeishuConnectorPanel({
  projectId,
  projectName,
  projectPath,
  initialTab = "status",
  variant = "config",
  onConnectorChange,
}: FeishuConnectorPanelProps) {
  const { promise, error: showError } = useAppNotifications()
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
  const [activeTab, setActiveTab] = useState<FeishuConnectorTab>(initialTab)

  const feishu = window.synapse?.connectors.feishu

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab, projectId])

  const refreshStatus = useCallback(async () => {
    if (!projectId || !feishu) return
    setIsLoadingStatus(true)
    try {
      setStatus(await feishu.getStatus(projectId))
    } catch {
      showError("刷新飞书连接状态失败")
    } finally {
      setIsLoadingStatus(false)
    }
  }, [feishu, projectId, showError])

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
    } catch {
      showError("刷新飞书工作区配置失败")
    } finally {
      setIsLoadingWorkspace(false)
    }
  }, [feishu, projectId, showError])

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

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
      void feishu.pollSetup(setup.setupId)
        .then((poll) => {
          if (cancelled) return
          setSetup((current) => current?.setupId === setup.setupId ? { ...current, poll } : current)
        })
        .catch(() => {
          if (cancelled) return
          setSetup((current) => current?.setupId === setup.setupId
            ? { ...current, poll: { status: "error", message: "轮询失败" } }
            : current)
          showError("飞书授权状态读取失败")
        })
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [feishu, setup, showError])

  const statusBadge = useMemo(() => {
    const connectorStatus = status?.connector?.status ?? "disabled"
    const label = statusLabel(connectorStatus)
    const variantName = connectorStatus === "error"
      ? "destructive"
      : connectorStatus === "connected"
        ? "default"
        : connectorStatus === "disabled"
          ? "secondary"
          : "outline"
    return <Badge variant={variantName}>{label}</Badge>
  }, [status])

  const notifyConnectorChanged = useCallback(async () => {
    await refreshStatus()
    onConnectorChange?.()
  }, [onConnectorChange, refreshStatus])

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
    await notifyConnectorChanged()
  }, [feishu, notifyConnectorChanged, promise, setup])

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
    await notifyConnectorChanged()
  }, [
    feishu,
    manualAppId,
    manualAppSecret,
    manualOwnerOpenId,
    notifyConnectorChanged,
    projectId,
    promise,
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
    onConnectorChange?.()
  }, [feishu, onConnectorChange, projectId, promise])

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
    onConnectorChange?.()
  }, [feishu, onConnectorChange, projectId, promise])

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

  const connector = status?.connector
  const workspaceDirectoryEnabled = workspaceConfig.enabled
  const workspaceBaseDirRequired = workspaceDirectoryEnabled && !workspaceConfig.baseDir?.trim()

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>飞书连接器</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">请先选择项目。</p>
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

  const statusCard = (
    <ProjectFeishuConnectorStatus
      connector={connector}
      isLoadingStatus={isLoadingStatus}
      projectName={projectName}
      projectPath={projectPath}
      running={status?.running ?? false}
      statusBadge={statusBadge}
      configured={status?.configured ?? false}
      onRefresh={refreshStatus}
      onStart={handleStart}
      onStop={handleStop}
    />
  )

  const credentialsCard = (
    <ProjectFeishuConnectorCredentials
      manualAppId={manualAppId}
      manualAppSecret={manualAppSecret}
      manualOwnerOpenId={manualOwnerOpenId}
      qrDataUrl={qrDataUrl}
      setup={setup}
      onBeginSetup={handleBeginSetup}
      onManualAppIdChange={setManualAppId}
      onManualAppSecretChange={setManualAppSecret}
      onManualOwnerOpenIdChange={setManualOwnerOpenId}
      onSaveManual={handleSaveManual}
      onSaveSetup={handleSaveSetup}
    />
  )

  const workspaceCard = (
    <ProjectFeishuWorkspaceDirectory
      bindings={workspaceBindings}
      config={workspaceConfig}
      isLoadingWorkspace={isLoadingWorkspace}
      workspaceBaseDirRequired={workspaceBaseDirRequired}
      workspaceDirectoryEnabled={workspaceDirectoryEnabled}
      onChooseBaseDir={handleChooseBaseDir}
      onConfigChange={setWorkspaceConfig}
      onSaveWorkspaceConfig={handleSaveWorkspaceConfig}
      onUnbindWorkspace={handleUnbindWorkspace}
    />
  )

  if (variant === "setup") {
    return credentialsCard
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FeishuConnectorTab)}>
      <TabsList>
        <TabsTrigger value="status">状态</TabsTrigger>
        <TabsTrigger value="credentials">凭据</TabsTrigger>
        <TabsTrigger value="workspace">频道目录</TabsTrigger>
      </TabsList>
      <TabsContent value="status">{statusCard}</TabsContent>
      <TabsContent value="credentials">{credentialsCard}</TabsContent>
      <TabsContent value="workspace">{workspaceCard}</TabsContent>
    </Tabs>
  )
}

function ProjectFeishuConnectorStatus({
  connector,
  configured,
  isLoadingStatus,
  projectName,
  projectPath,
  running,
  statusBadge,
  onRefresh,
  onStart,
  onStop,
}: {
  connector: SynapseFeishuConnectorRuntimeStatus["connector"]
  configured: boolean
  isLoadingStatus: boolean
  projectName?: string
  projectPath?: string
  running: boolean
  statusBadge: ReactNode
  onRefresh: () => void
  onStart: () => void
  onStop: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          飞书连接器
          {statusBadge}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            disabled={isLoadingStatus}
            onClick={() => onRefresh()}
            aria-label="刷新连接状态"
          >
            <RefreshCw className={isLoadingStatus ? "animate-spin" : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ConnectorDetail label="App ID" value={connector?.appId ?? "未配置"} />
          <ConnectorDetail label="项目" value={projectName ?? "未选择"} />
          <ConnectorDetail label="运行目录" value={projectPath ?? "未选择"} wrap />
          <ConnectorDetail label="运行状态" value={running ? "已连接" : "未连接"} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={running || !configured}
            onClick={() => onStart()}
          >
            <Play data-icon="inline-start" />
            连接
          </Button>
          <Button
            variant="outline"
            disabled={!running}
            onClick={() => onStop()}
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
  )
}

function ProjectFeishuConnectorCredentials({
  manualAppId,
  manualAppSecret,
  manualOwnerOpenId,
  qrDataUrl,
  setup,
  onBeginSetup,
  onManualAppIdChange,
  onManualAppSecretChange,
  onManualOwnerOpenIdChange,
  onSaveManual,
  onSaveSetup,
}: {
  manualAppId: string
  manualAppSecret: string
  manualOwnerOpenId: string
  qrDataUrl: string | null
  setup: SetupState | null
  onBeginSetup: () => void
  onManualAppIdChange: (value: string) => void
  onManualAppSecretChange: (value: string) => void
  onManualOwnerOpenIdChange: (value: string) => void
  onSaveManual: () => void
  onSaveSetup: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>连接凭据</CardTitle>
        <CardDescription>保存飞书应用凭据。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
        <div className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel>扫码授权</FieldLabel>
              <div>
                <Button
                  variant="outline"
                  onClick={() => onBeginSetup()}
                >
                  <QrCode data-icon="inline-start" />
                  创建二维码
                </Button>
              </div>
            </Field>
            {setup?.poll?.status === "completed" ? (
              <Button onClick={() => onSaveSetup()}>
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
                  onChange={(event) => onManualAppIdChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="feishu-app-secret">App Secret</FieldLabel>
                <Input
                  id="feishu-app-secret"
                  type="password"
                  value={manualAppSecret}
                  onChange={(event) => onManualAppSecretChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="feishu-owner-open-id">Owner Open ID</FieldLabel>
                <Input
                  id="feishu-owner-open-id"
                  value={manualOwnerOpenId}
                  onChange={(event) => onManualOwnerOpenIdChange(event.target.value)}
                />
              </Field>
            </div>
            <div>
              <Button
                disabled={!manualAppId.trim() || !manualAppSecret.trim()}
                onClick={() => onSaveManual()}
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
  )
}

function ProjectFeishuWorkspaceDirectory({
  bindings,
  config,
  isLoadingWorkspace,
  workspaceBaseDirRequired,
  workspaceDirectoryEnabled,
  onChooseBaseDir,
  onConfigChange,
  onSaveWorkspaceConfig,
  onUnbindWorkspace,
}: {
  bindings: SynapseFeishuWorkspaceBindingsSummary
  config: SynapseFeishuWorkspaceConfig
  isLoadingWorkspace: boolean
  workspaceBaseDirRequired: boolean
  workspaceDirectoryEnabled: boolean
  onChooseBaseDir: () => void
  onConfigChange: (config: SynapseFeishuWorkspaceConfig) => void
  onSaveWorkspaceConfig: () => void
  onUnbindWorkspace: (binding: SynapseFeishuWorkspaceBinding) => void
}) {
  return (
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
                  onConfigChange({ ...config, enabled })}
              />
            </Field>
            <Field data-disabled={!workspaceDirectoryEnabled || undefined}>
              <FieldLabel htmlFor="feishu-workspace-base-dir">本地根目录</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="feishu-workspace-base-dir"
                  value={config.baseDir ?? ""}
                  disabled={!workspaceDirectoryEnabled}
                  onChange={(event) =>
                    onConfigChange({
                      ...config,
                      baseDir: event.target.value,
                    })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!workspaceDirectoryEnabled}
                  onClick={() => onChooseBaseDir()}
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
                checked={config.autoBindByChannelName ?? true}
                disabled={!workspaceDirectoryEnabled}
                onCheckedChange={(autoBindByChannelName) =>
                  onConfigChange({ ...config, autoBindByChannelName })}
              />
            </Field>
            <div>
              <Button
                disabled={workspaceBaseDirRequired}
                onClick={() => onSaveWorkspaceConfig()}
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
              {bindings.project.length + bindings.shared.length}
            </Badge>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <WorkspaceBindingTable
              title="当前项目绑定"
              bindings={bindings.project}
              isLoading={isLoadingWorkspace}
              onUnbind={onUnbindWorkspace}
            />
            <WorkspaceBindingTable
              title="共享绑定"
              bindings={bindings.shared}
              isLoading={isLoadingWorkspace}
              onUnbind={onUnbindWorkspace}
            />
          </div>
        </section>
      </CardContent>
    </Card>
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

export { FeishuConnectorPanel }
