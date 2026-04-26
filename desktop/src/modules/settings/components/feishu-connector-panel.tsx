import { useCallback, useEffect, useMemo, useState } from "react"
import { FolderOpen, Play, QrCode, RefreshCw, Save, Square, Trash2 } from "lucide-react"
import QRCode from "qrcode"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
}

type SetupState = SynapseFeishuSetupBeginResult & {
  poll?: SynapseFeishuSetupPollResult
}

function FeishuConnectorPanel({ projectId }: FeishuConnectorPanelProps) {
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
        loading: "正在保存多工作区...",
        success: "多工作区已保存。",
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

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">飞书</CardTitle>
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          飞书
          {statusBadge}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            disabled={isLoadingStatus}
            onClick={() => void refreshStatus()}
            aria-label="刷新"
          >
            <RefreshCw className={isLoadingStatus ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={status?.running || !status?.configured}
            onClick={() => void handleStart()}
          >
            <Play className="size-4" />
            连接
          </Button>
          <Button
            variant="outline"
            disabled={!status?.running}
            onClick={() => void handleStop()}
          >
            <Square className="size-4" />
            断开
          </Button>
          <span className="text-sm text-muted-foreground">
            {status?.connector?.appId ?? "未配置"}
          </span>
        </div>

        {status?.connector?.lastError ? (
          <Alert variant="destructive">
            <AlertTitle>连接失败</AlertTitle>
            <AlertDescription>{status.connector.lastError}</AlertDescription>
          </Alert>
        ) : null}

        <Separator />

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
          <FieldGroup>
            <Field>
              <FieldLabel>扫码授权</FieldLabel>
              <FieldDescription>使用飞书开发者账号授权个人应用。</FieldDescription>
              <div>
                <Button
                  variant="outline"
                  onClick={() => void handleBeginSetup()}
                >
                  <QrCode className="size-4" />
                  创建二维码
                </Button>
              </div>
            </Field>
            {setup?.poll?.status === "completed" ? (
              <Button onClick={() => void handleSaveSetup()}>
                <Save className="size-4" />
                保存授权
              </Button>
            ) : null}
            {setup?.poll?.message ? (
              <p className="text-sm text-muted-foreground">{setup.poll.message}</p>
            ) : null}
          </FieldGroup>

          <div className="flex min-h-56 items-center justify-center rounded-lg border border-border bg-background p-3">
            {qrDataUrl ? (
              <img
                className="size-48"
                src={qrDataUrl}
                alt="飞书授权二维码"
              />
            ) : (
              <p className="text-sm text-muted-foreground">暂无二维码</p>
            )}
          </div>
        </div>

        <Separator />

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
              <FieldLabel htmlFor="feishu-owner-open-id">Open ID</FieldLabel>
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
              <Save className="size-4" />
              保存
            </Button>
          </div>
        </FieldGroup>

        <Separator />

        <FieldGroup>
          <Field orientation="horizontal">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="feishu-workspace-enabled">多工作区</FieldLabel>
              <FieldDescription>按飞书频道绑定本地目录。</FieldDescription>
            </div>
            <Switch
              id="feishu-workspace-enabled"
              checked={workspaceConfig.enabled}
              onCheckedChange={(enabled) =>
                setWorkspaceConfig((current) => ({ ...current, enabled }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="feishu-workspace-base-dir">工作区目录</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="feishu-workspace-base-dir"
                value={workspaceConfig.baseDir ?? ""}
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
                onClick={() => void handleChooseBaseDir()}
                aria-label="选择目录"
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="feishu-workspace-auto-bind">按频道名绑定</FieldLabel>
            <Switch
              id="feishu-workspace-auto-bind"
              checked={workspaceConfig.autoBindByChannelName ?? true}
              onCheckedChange={(autoBindByChannelName) =>
                setWorkspaceConfig((current) => ({ ...current, autoBindByChannelName }))}
            />
          </Field>
          <div>
            <Button
              disabled={workspaceConfig.enabled && !workspaceConfig.baseDir?.trim()}
              onClick={() => void handleSaveWorkspaceConfig()}
            >
              <Save />
              保存多工作区
            </Button>
          </div>
        </FieldGroup>

        <WorkspaceBindingTable
          title="项目绑定"
          bindings={workspaceBindings.project}
          isLoading={isLoadingWorkspace}
          onUnbind={handleUnbindWorkspace}
        />
        <WorkspaceBindingTable
          title="shared 绑定"
          bindings={workspaceBindings.shared}
          isLoading={isLoadingWorkspace}
          onUnbind={handleUnbindWorkspace}
        />
      </CardContent>
    </Card>
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
