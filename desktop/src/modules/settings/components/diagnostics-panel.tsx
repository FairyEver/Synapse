import { ClipboardCopy, Download, LoaderCircle, Play, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState, type ReactNode } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { errorLogMessage, errorLogMeta, sanitizeError } from "@/lib/error-sanitize"
import {
  appendDiagnosticsCheck,
  buildDiagnosticsSummary,
  createRendererMainRoundtripCheck,
  formatDiagnosticsDate,
  formatDiagnosticsValue,
  getDiagnosticsStatusLabel,
} from "@/lib/diagnostics-summary"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type {
  SynapseDiagnosticsCheck,
  SynapseKnowledgeBaseStorageDiagnostics,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsStatus,
} from "@/types/diagnostics"

const logger = createRendererLogger("settings.diagnostics")
const WINDOWS_COMPATIBILITY_KEY = "windowsCompatibility"
const MAC_COMPATIBILITY_KEY = "macCompatibility"
const COMPATIBILITY_CHECK_GROUPS = new Set(["Windows 兼容性", "macOS 兼容性"])
const LOCAL_ENVIRONMENT_CHECK_GROUPS = new Set(["系统", "应用", "路径与权限", "IPC"])

async function runDiagnosticsWithIpcCheck(): Promise<SynapseDiagnosticsReport> {
  const bridge = requireSynapseBridge()
  const report = await bridge.ops.runDiagnostics()
  const requestedAt = new Date().toISOString()
  const startedAt = getMonotonicNow()

  try {
    const result = await bridge.ops.ping()
    const durationMs = Math.max(0, Math.round(getMonotonicNow() - startedAt))
    return appendDiagnosticsCheck(
      report,
      createRendererMainRoundtripCheck({
        durationMs,
        requestedAt,
        completedAt: new Date().toISOString(),
        mainReceivedAt: result.receivedAt,
      }),
    )
  } catch (error) {
    const durationMs = Math.max(0, Math.round(getMonotonicNow() - startedAt))
    return appendDiagnosticsCheck(
      report,
      createRendererMainRoundtripCheck({
        durationMs,
        requestedAt,
        completedAt: new Date().toISOString(),
        error: sanitizeError(errorLogMessage(error, "IPC 往返失败")),
      }),
    )
  }
}

function getMonotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}

function DiagnosticsPanel() {
  const { error: showError, promise, success } = useAppNotifications()
  const [report, setReport] = useState<SynapseDiagnosticsReport | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleRun = useCallback(async () => {
    setIsRunning(true)
    logger.info("Diagnostics run initiated.")
    try {
      const nextReport = await promise(
        () => runDiagnosticsWithIpcCheck(),
        {
          trackingName: "settings.diagnostics.run",
          loading: "正在运行诊断...",
          success: () => "诊断完成",
          error: () => "诊断失败",
        },
      )
      setReport(nextReport)
    } catch (error) {
      logger.error("Diagnostics run failed.", errorLogMeta(error))
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
          trackingName: "settings.diagnostics.export",
          loading: "正在导出诊断包...",
          success: (exportResult) => exportResult.success ? "诊断包已导出" : null,
          error: () => "导出诊断包失败",
        },
      )
      if (result.success && result.filePath) {
        requireSynapseBridge().shell.showItemInFolder(result.filePath).catch(() => {})
      }
    } catch (error) {
      logger.error("Diagnostics bundle export failed.", errorLogMeta(error))
    } finally {
      setIsExporting(false)
    }
  }, [promise, report])

  const handleCopySummary = useCallback(async () => {
    if (!report) return

    try {
      await navigator.clipboard.writeText(buildDiagnosticsSummary(report))
      success("诊断摘要已复制")
    } catch (error) {
      showError(error instanceof Error ? error.message : "复制失败")
    }
  }, [report, showError, success])

  return (
    <div className="flex flex-col gap-2">
      <SettingsGroup>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-medium text-foreground">结论</p>
            {report ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <StatusBadge status={report.overallStatus} />
                <span>{formatDiagnosticsDate(report.generatedAt)}</span>
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
            <AlertDialog data-track="diagnostics-export-confirm">
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!report || isExporting}
                >
                  {isExporting ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  导出诊断包
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>导出诊断包</AlertDialogTitle>
                  <AlertDialogDescription>
                    诊断包会包含日志、配置摘要和数据库副本。数据库副本可能包含会话、审计、工作流和调度数据。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleExport()}>
                    继续导出
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              disabled={!report}
              onClick={() => void handleCopySummary()}
            >
              <ClipboardCopy data-icon="inline-start" />
              复制摘要
            </Button>
          </div>
        </div>
      </SettingsGroup>

      {report ? <DiagnosticsReportDetails report={report} /> : null}
    </div>
  )
}

function DiagnosticsReportDetails({ report }: { report: SynapseDiagnosticsReport }) {
  const groups = useMemo(() => groupChecks(report.checks), [report])
  const windowsCompatibilityEntries = getWindowsCompatibilityEntries(report.system[WINDOWS_COMPATIBILITY_KEY])
  const macCompatibilityEntries = getMacCompatibilityEntries(report.system[MAC_COMPATIBILITY_KEY])
  const compatibilityKeys = [WINDOWS_COMPATIBILITY_KEY, MAC_COMPATIBILITY_KEY]
  const infoSections = [
    { title: "本机信息", entries: getInfoEntries(report.system, compatibilityKeys) },
    { title: "应用信息", entries: getInfoEntries(report.app) },
    {
      title: "知识库存储",
      entries: getKnowledgeBaseStorageEntries(report.knowledgeBaseStorage),
    },
    { title: "当前上下文", entries: getInfoEntries(report.activeContext) },
  ].filter((section) => section.entries.length > 0)
  const tabs = createDiagnosticsTabs({
    infoSections,
    windowsCompatibilityEntries,
    macCompatibilityEntries,
    groups,
  })

  if (tabs.length === 0) return null

  return (
    <Tabs
      defaultValue={tabs[0].value}
      data-track="diagnostics-details-tabs"
      className="min-w-0"
    >
      <TabsList variant="line" className="max-w-full flex-wrap justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="flex-none">
            {tab.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

type InfoSectionModel = {
  title: string
  entries: [string, unknown][]
}

type DiagnosticsTab = {
  value: string
  title: string
  content: ReactNode
}

type CheckGroupModel = {
  group: string
  checks: SynapseDiagnosticsCheck[]
}

function createDiagnosticsTabs({
  infoSections,
  windowsCompatibilityEntries,
  macCompatibilityEntries,
  groups,
}: {
  infoSections: InfoSectionModel[]
  windowsCompatibilityEntries: [string, unknown][]
  macCompatibilityEntries: [string, unknown][]
  groups: Map<string, SynapseDiagnosticsCheck[]>
}): DiagnosticsTab[] {
  const tabs: DiagnosticsTab[] = []
  const checkGroups = Array.from(groups.entries()).map(([group, checks]) => ({ group, checks }))
  const compatibilityCheckGroups = checkGroups.filter((item) => COMPATIBILITY_CHECK_GROUPS.has(item.group))
  const localEnvironmentCheckGroups = checkGroups.filter((item) => LOCAL_ENVIRONMENT_CHECK_GROUPS.has(item.group))
  const runtimeCheckGroups = checkGroups.filter(
    (item) => !COMPATIBILITY_CHECK_GROUPS.has(item.group) && !LOCAL_ENVIRONMENT_CHECK_GROUPS.has(item.group),
  )

  if (infoSections.length > 0) {
    tabs.push({
      value: "info",
      title: "基础信息",
      content: (
        <SettingsGroup>
          {infoSections.map((section) => (
            <InfoSection
              key={section.title}
              title={section.title}
              entries={section.entries}
            />
          ))}
        </SettingsGroup>
      ),
    })
  }

  if (
    windowsCompatibilityEntries.length > 0
    || macCompatibilityEntries.length > 0
    || compatibilityCheckGroups.length > 0
  ) {
    tabs.push(createCompatibilityTab({
      windowsCompatibilityEntries,
      macCompatibilityEntries,
      compatibilityCheckGroups,
    }))
  }

  if (localEnvironmentCheckGroups.length > 0) {
    tabs.push({
      value: "local-environment",
      title: "本地环境",
      content: (
        <CheckGroupList groups={localEnvironmentCheckGroups} />
      ),
    })
  }

  if (runtimeCheckGroups.length > 0) {
    tabs.push({
      value: "runtime",
      title: "运行服务",
      content: (
        <CheckGroupList groups={runtimeCheckGroups} />
      ),
    })
  }

  return tabs
}

function createCompatibilityTab({
  windowsCompatibilityEntries,
  macCompatibilityEntries,
  compatibilityCheckGroups,
}: {
  windowsCompatibilityEntries: [string, unknown][]
  macCompatibilityEntries: [string, unknown][]
  compatibilityCheckGroups: CheckGroupModel[]
}): DiagnosticsTab {
  return {
    value: "compatibility",
    title: "兼容性",
    content: (
      <div className="flex min-w-0 flex-col gap-2">
        {windowsCompatibilityEntries.length > 0 ? (
          <SettingsGroup>
            <InfoSection
              title="Windows 兼容性"
              entries={windowsCompatibilityEntries}
            />
          </SettingsGroup>
        ) : null}
        {macCompatibilityEntries.length > 0 ? (
          <SettingsGroup>
            <InfoSection
              title="macOS 兼容性"
              entries={macCompatibilityEntries}
            />
          </SettingsGroup>
        ) : null}
        <CheckGroupList groups={compatibilityCheckGroups} />
      </div>
    ),
  }
}

function CheckGroupList({ groups }: { groups: CheckGroupModel[] }) {
  if (groups.length === 0) return null

  return (
    <>
      {groups.map(({ group, checks }) => (
        <SettingsGroup key={group} sectionClassName="py-3">
          <p className="text-sm font-medium text-foreground">{group}</p>
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </SettingsGroup>
      ))}
    </>
  )
}

function InfoSection({
  title,
  entries,
}: {
  title: string
  entries: [string, unknown][]
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="flex flex-col gap-2">
        {entries.map(([key, value]) => (
          <LongValueRow key={key} label={key} value={formatDiagnosticsValue(value)} />
        ))}
      </div>
    </div>
  )
}

function CheckRow({ check }: { check: SynapseDiagnosticsCheck }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
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
            <LongValueRow key={key} label={key} value={formatDiagnosticsValue(value)} />
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
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`复制 ${label}`}
        onClick={() => void handleCopy()}
      >
        <ClipboardCopy />
      </Button>
    </div>
  )
}

function getInfoEntries(values: Record<string, unknown>, excludedKeys: string[] = []): [string, unknown][] {
  const excluded = new Set(excludedKeys)
  return Object.entries(values).filter(([key, value]) => value !== undefined && !excluded.has(key))
}

function getWindowsCompatibilityEntries(value: unknown): [string, unknown][] {
  if (!isRecord(value)) return []

  const entries: [string, unknown][] = [
    ["平台", value.platform],
    ["架构", value.arch],
    ["系统版本", value.release],
    ["正在 Windows 运行", value.runningOnWindows],
    ["PATH 分隔符", value.pathDelimiter],
    ["环境变量", value.env],
    ["路径", value.paths],
  ]

  return entries.filter(([, entryValue]) => entryValue !== undefined)
}

function getMacCompatibilityEntries(value: unknown): [string, unknown][] {
  if (!isRecord(value)) return []

  const entries: [string, unknown][] = [
    ["平台", value.platform],
    ["架构", value.arch],
    ["系统版本", value.release],
    ["正在 macOS 运行", value.runningOnMac],
    ["PATH 分隔符", value.pathDelimiter],
    ["环境变量", value.env],
    ["路径", value.paths],
  ]

  return entries.filter(([, entryValue]) => entryValue !== undefined)
}

function getKnowledgeBaseStorageEntries(
  value: SynapseKnowledgeBaseStorageDiagnostics | undefined,
): [string, unknown][] {
  if (!value) return []

  const entries: [string, unknown][] = [
    ["模式", value.mode === "custom" ? "自定义" : "默认"],
    ["状态", value.available ? "可用" : "不可用"],
    ["存储位置", value.rootPath],
    ["知识库目录", value.knowledgeBasesPath],
    ["知识库数量", value.runtimeCount],
    ["缺失目录", value.missingRuntimeCount],
  ]

  if (value.oldAbsoluteReferenceCount > 0) {
    entries.push(["旧绝对路径", "发现旧绝对路径引用。"])
  }

  return entries
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function StatusBadge({ status }: { status: SynapseDiagnosticsStatus }) {
  return (
    <Badge variant={status === "failed" ? "destructive" : "secondary"}>
      {getDiagnosticsStatusLabel(status)}
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

export {
  DiagnosticsPanel,
  DiagnosticsReportDetails,
  groupChecks,
}
