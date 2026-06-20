import { useState } from "react"
import { ClipboardCheck, Download, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitEnvironmentState, SynapseGitRepositorySummary } from "@/types/git"
import { buildGitDiagnosticsText } from "./git-environment-panel"

type GitInstallPanelProps = {
  readonly environment: SynapseGitEnvironmentState | null
  readonly repositorySummaries: readonly SynapseGitRepositorySummary[]
  readonly loading: boolean
  readonly error?: string | null
  readonly onRefresh: () => Promise<void>
}

type DownloadTarget = {
  readonly label: string
  readonly url: string
}

type InstallStepStatus = "done" | "current" | "pending"

function fallbackValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "未检测到"
}

function platformLabel(platform: string | null | undefined): string {
  if (platform === "win32") return "Windows"
  if (platform === "darwin") return "macOS"
  if (platform === "linux") return "Linux"
  return fallbackValue(platform)
}

function downloadTarget(platform: string | null | undefined): DownloadTarget | null {
  if (platform === "win32") {
    return { label: "Git for Windows", url: "https://git-scm.com/download/win" }
  }
  if (platform === "darwin") {
    return { label: "Git for macOS", url: "https://git-scm.com/download/mac" }
  }
  return null
}

function installState(environment: SynapseGitEnvironmentState | null): string {
  if (!environment) return "检测中"
  if (environment.gitAvailable) return "已安装"
  if (environment.platform === "linux") return "当前系统暂不支持图形化引导"
  return "未检测到"
}

function sourceLabel(environment: SynapseGitEnvironmentState | null): string {
  if (!environment?.gitAvailable) return "未检测到"
  if (environment.effectiveGitPath === environment.shellGitPath) return "Login Shell"
  if (environment.effectiveGitPath === environment.processGitPath) return "App PATH"
  return "PATH"
}

function installStepBadge(status: InstallStepStatus): string {
  if (status === "done") return "完成"
  if (status === "current") return "当前"
  return "待处理"
}

function installSteps(environment: SynapseGitEnvironmentState | null, target: DownloadTarget | null, downloadOpened: boolean): readonly {
  readonly label: string
  readonly status: InstallStepStatus
}[] {
  if (!environment || environment.gitAvailable || !target) return []
  return [
    { label: "检测系统", status: "done" },
    { label: "打开下载页面", status: downloadOpened ? "done" : "current" },
    { label: "完成安装", status: downloadOpened ? "current" : "pending" },
    { label: "重新检测", status: "pending" },
  ]
}

function FieldRow({ label, value, mono = false }: {
  readonly label: string
  readonly value: string | null | undefined
  readonly mono?: boolean
}) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-3">
      <div className="text-sm font-medium">{label}</div>
      <div
        className={mono ? "break-all font-mono text-xs text-muted-foreground" : "break-all text-sm text-muted-foreground"}
        data-allow-select="true"
      >
        {fallbackValue(value)}
      </div>
    </div>
  )
}

export function GitInstallPanel({
  environment,
  repositorySummaries,
  loading,
  error,
  onRefresh,
}: GitInstallPanelProps) {
  const target = downloadTarget(environment?.platform)
  const [message, setMessage] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [downloadOpened, setDownloadOpened] = useState(false)
  const steps = installSteps(environment, target, downloadOpened)
  const canCopyDiagnostics = Boolean(error || environment?.platform === "linux")
  const openDownload = async () => {
    if (!target) return
    setMessage(null)
    try {
      await requireSynapseBridge().shell.openExternal(target.url)
      setDownloadOpened(true)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "打开下载页面失败。")
    }
  }
  const copyDiagnostics = async () => {
    setCopyMessage(null)
    try {
      await navigator.clipboard.writeText(buildGitDiagnosticsText(environment, repositorySummaries))
      setCopyMessage("已复制诊断信息。")
    } catch (err) {
      setCopyMessage(err instanceof Error ? err.message : "复制失败。")
    }
  }

  return (
    <ScrollArea className="h-full bg-surface">
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>安装 Git</CardTitle>
            <CardAction>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void onRefresh()}>
                <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
                重新检测
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={environment?.gitAvailable ? "secondary" : "outline"}>{installState(environment)}</Badge>
              <span className="text-sm text-muted-foreground">{platformLabel(environment?.platform)}</span>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>检测失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {message ? (
              <Alert variant="destructive">
                <AlertTitle>打开失败</AlertTitle>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ) : null}

            {!environment?.gitAvailable && environment?.platform === "linux" ? (
              <Alert>
                <AlertTitle>Linux</AlertTitle>
                <AlertDescription>当前系统暂不支持图形化引导</AlertDescription>
              </Alert>
            ) : null}

            {target && !environment?.gitAvailable ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void openDownload()}>
                  <Download data-icon="inline-start" />
                  {target.label}
                </Button>
              </div>
            ) : null}
            {canCopyDiagnostics ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void copyDiagnostics()}>
                  <ClipboardCheck data-icon="inline-start" />
                  复制诊断信息
                </Button>
                {copyMessage ? <span className="text-sm text-muted-foreground">{copyMessage}</span> : null}
              </div>
            ) : null}

            {steps.length > 0 ? (
              <div className="divide-y">
                {steps.map((step) => (
                  <div key={step.label} className="grid gap-2 py-2 md:grid-cols-[6rem_minmax(0,1fr)] md:items-center">
                    <Badge variant={step.status === "current" ? "default" : "outline"} className="w-fit">
                      {installStepBadge(step.status)}
                    </Badge>
                    <div className="text-sm font-medium">{step.label}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <FieldRow label="平台" value={platformLabel(environment?.platform)} />
              <FieldRow label="来源" value={sourceLabel(environment)} />
              <FieldRow label="版本" value={environment?.gitVersion} />
              <FieldRow label="路径" value={environment?.effectiveGitPath ?? environment?.gitPath} mono />
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
