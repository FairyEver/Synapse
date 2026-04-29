import { ClipboardCopy, Download, LoaderCircle, Play, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsStatus,
} from "@/types/diagnostics"

const logger = createRendererLogger("settings.diagnostics")

function DiagnosticsPanel() {
  const { error: showError, promise } = useAppNotifications()
  const [report, setReport] = useState<SynapseDiagnosticsReport | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isJsonOpen, setIsJsonOpen] = useState(false)

  const rawJson = useMemo(() => report ? JSON.stringify(report, null, 2) : "", [report])

  const handleRun = useCallback(async () => {
    setIsRunning(true)
    logger.info("Diagnostics run initiated.")
    try {
      const nextReport = await promise(
        () => requireSynapseBridge().ops.runDiagnostics(),
        {
          loading: "正在运行诊断...",
          success: () => "诊断完成",
          error: (error) => error instanceof Error ? error.message : "诊断失败",
        },
      )
      setReport(nextReport)
    } catch (error) {
      logger.error("Diagnostics run failed.", error)
    } finally {
      setIsRunning(false)
    }
  }, [promise])

  const handleExport = useCallback(async () => {
    if (!report) return
    setIsExporting(true)
    logger.info("Diagnostics bundle export initiated.")
    try {
      const result = await promise(
        () => requireSynapseBridge().ops.exportDiagnosticsBundle({ report }),
        {
          loading: "正在导出诊断包...",
          success: (exportResult) => exportResult.success ? "诊断包已导出" : null,
          error: (error) => error instanceof Error ? error.message : "导出诊断包失败",
        },
      )
      if (result.success && result.filePath) {
        setReport({
          ...report,
          bundle: {
            lastExportedAt: new Date().toISOString(),
            lastExportPath: result.filePath,
          },
        })
      }
    } finally {
      setIsExporting(false)
    }
  }, [promise, report])

  const handleCopyJson = useCallback(async () => {
    if (!rawJson) return
    try {
      await navigator.clipboard.writeText(rawJson)
    } catch (error) {
      showError(error instanceof Error ? error.message : "复制失败")
    }
  }, [rawJson, showError])

  return (
    <>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <CardTitle>结论</CardTitle>
                {report ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <StatusBadge status={report.overallStatus} />
                    <span>{formatDate(report.generatedAt)}</span>
                    <span>通过 {report.summary.ok}</span>
                    <span>异常 {report.summary.degraded}</span>
                    <span>失败 {report.summary.failed}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">运行诊断后显示结果。</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={isRunning} onClick={() => void handleRun()}>
                  {isRunning ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : report ? (
                    <RefreshCw data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  运行诊断
                </Button>
                <Button
                  variant="outline"
                  disabled={!report || isExporting}
                  onClick={() => void handleExport()}
                >
                  {isExporting ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  导出诊断包
                </Button>
                <Button
                  variant="outline"
                  disabled={!report}
                  onClick={() => setIsJsonOpen(true)}
                >
                  原始 JSON
                </Button>
              </div>
            </div>
          </CardHeader>
          {report?.bundle?.lastExportPath ? (
            <CardContent>
              <LongValueRow label="导出位置" value={report.bundle.lastExportPath} />
            </CardContent>
          ) : null}
        </Card>

        {report ? <DiagnosticsReportDetails report={report} /> : null}
      </div>

      <Dialog open={isJsonOpen} onOpenChange={setIsJsonOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>原始 JSON</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-96 rounded-md border">
            <pre className="min-w-0 overflow-x-auto whitespace-pre p-4 text-sm">
              {rawJson}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsJsonOpen(false)}>
              关闭
            </Button>
            <Button onClick={() => void handleCopyJson()}>
              <ClipboardCopy data-icon="inline-start" />
              复制 JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DiagnosticsReportDetails({ report }: { report: SynapseDiagnosticsReport }) {
  const groups = useMemo(() => groupChecks(report.checks), [report])

  return (
    <>
      <InfoSection title="本机信息" values={report.system} />
      <InfoSection title="应用信息" values={report.app} />
      <InfoSection title="当前上下文" values={report.activeContext} />
      {Array.from(groups.entries()).map(([group, checks]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-base">{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  )
}

function InfoSection({
  title,
  values,
}: {
  title: string
  values: Record<string, unknown>
}) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined)

  if (entries.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {entries.map(([key, value]) => (
          <LongValueRow key={key} label={key} value={formatValue(value)} />
        ))}
      </CardContent>
    </Card>
  )
}

function CheckRow({ check }: { check: SynapseDiagnosticsCheck }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{check.name}</div>
          <p className="break-words text-sm text-muted-foreground">{check.message}</p>
        </div>
        <StatusBadge status={check.status} />
      </div>
      {check.details ? (
        <div className="flex flex-col gap-2">
          {Object.entries(check.details).map(([key, value]) => (
            <LongValueRow key={key} label={key} value={formatValue(value)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LongValueRow({ label, value }: { label: string; value: string }) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (error) {
      logger.error("Failed to copy diagnostics value.", error)
    }
  }, [value])

  return (
    <div className="grid min-w-0 gap-2 text-sm md:grid-cols-[10rem_minmax(0,1fr)_auto]">
      <span className="break-words text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">{value}</span>
      <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
        <ClipboardCopy data-icon="inline-start" />
        复制
      </Button>
    </div>
  )
}

function StatusBadge({ status }: { status: SynapseDiagnosticsStatus }) {
  return (
    <Badge variant={status === "failed" ? "destructive" : "secondary"}>
      {getStatusLabel(status)}
    </Badge>
  )
}

function groupChecks(
  checks: SynapseDiagnosticsCheck[],
): Map<string, SynapseDiagnosticsCheck[]> {
  const groups = new Map<string, SynapseDiagnosticsCheck[]>()

  for (const check of checks) {
    const group = groups.get(check.group) ?? []
    group.push(check)
    groups.set(check.group, group)
  }

  return groups
}

function getStatusLabel(status: SynapseDiagnosticsStatus): string {
  if (status === "ok") return "通过"
  if (status === "degraded") return "异常"
  if (status === "failed") return "失败"
  return "跳过"
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export {
  DiagnosticsPanel,
  DiagnosticsReportDetails,
  groupChecks,
}
