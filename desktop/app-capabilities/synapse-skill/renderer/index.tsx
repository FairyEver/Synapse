import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "../../../src/app-shell/config"
import {
  inspectGlobalSkillInstallations,
  installSourceToEditorTargets,
} from "../../../src/app-shell/installers"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { EditorIcon } from "../../../src/components/editor-icon"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseEditorAdapterSummary } from "../../../src/types/editor"
import type { SynapseEditorInstallStatusEntry, SynapseEditorInstallStatusValue } from "../../../src/types/editor-install-status"
import type { SynapseInstallSourceTargetResult, SynapseSkillInstallerSource } from "../../../src/types/installers"

const logger = createRendererLogger("synapse-skill.app")

function releaseInstallSource(source: SynapseSkillInstallerSource): void {
  if (!source.preparedSourceId) return
  void requireBridgeDomain("synapseSkill").releaseInstallSource(source.preparedSourceId).catch((error) => {
    logger.warn("Failed to release Synapse Skill install source.", error)
  })
}

type InstallStatusPolicy = {
  readonly label: string
  readonly badgeVariant: "default" | "secondary" | "destructive" | "outline"
  readonly showBadge: boolean
  readonly rowAction: "install" | "update" | "handle" | "reinstall" | null
  readonly rowActionLabel: string | null
  readonly batchMode: "install" | "update" | null
  readonly summaryKind: "missing" | "update" | "action" | null
}

const installStatusPolicies: Record<SynapseEditorInstallStatusValue, InstallStatusPolicy> = {
  conflict: {
    label: "冲突",
    badgeVariant: "destructive",
    showBadge: true,
    rowAction: "handle",
    rowActionLabel: "处理",
    batchMode: null,
    summaryKind: "action",
  },
  external_same_name: {
    label: "外部同名",
    badgeVariant: "outline",
    showBadge: true,
    rowAction: "handle",
    rowActionLabel: "处理",
    batchMode: null,
    summaryKind: "action",
  },
  installed: {
    label: "已安装",
    badgeVariant: "default",
    showBadge: false,
    rowAction: "reinstall",
    rowActionLabel: "重新安装",
    batchMode: null,
    summaryKind: null,
  },
  needs_update: {
    label: "需更新",
    badgeVariant: "secondary",
    showBadge: true,
    rowAction: "update",
    rowActionLabel: "更新",
    batchMode: "update",
    summaryKind: "update",
  },
  not_installed: {
    label: "未安装",
    badgeVariant: "outline",
    showBadge: false,
    rowAction: "install",
    rowActionLabel: "安装",
    batchMode: "install",
    summaryKind: "missing",
  },
  unavailable: {
    label: "不可用",
    badgeVariant: "outline",
    showBadge: true,
    rowAction: null,
    rowActionLabel: null,
    batchMode: null,
    summaryKind: null,
  },
  unsupported: {
    label: "不支持",
    badgeVariant: "outline",
    showBadge: true,
    rowAction: null,
    rowActionLabel: null,
    batchMode: null,
    summaryKind: null,
  },
}

function statusBadgeVariant(status: SynapseEditorInstallStatusEntry["status"] | undefined) {
  return status ? installStatusPolicies[status].badgeVariant : "outline"
}

function canBatchInstall(status: SynapseEditorInstallStatusEntry["status"] | undefined): boolean {
  return status ? installStatusPolicies[status].batchMode !== null : false
}

function getBatchActionLabel(entries: SynapseEditorInstallStatusEntry[]): string {
  const hasMissing = entries.some((entry) => installStatusPolicies[entry.status].batchMode === "install")
  const hasUpdate = entries.some((entry) => installStatusPolicies[entry.status].batchMode === "update")
  if (hasMissing && hasUpdate) return "安装并更新"
  if (hasUpdate) return "更新已安装项"
  if (hasMissing) return "安装缺失项"
  return "全部已安装"
}

function getBatchGroups(entries: SynapseEditorInstallStatusEntry[]) {
  return (["install", "update"] as const).flatMap((mode) => {
    const matchingEntries = entries.filter((entry) => installStatusPolicies[entry.status].batchMode === mode)
    return matchingEntries.length > 0 ? [{ mode, entries: matchingEntries }] : []
  })
}

function getInstallSummaryLabel(entries: SynapseEditorInstallStatusEntry[]): string {
  const missingCount = entries.filter((entry) => installStatusPolicies[entry.status].summaryKind === "missing").length
  const updateCount = entries.filter((entry) => installStatusPolicies[entry.status].summaryKind === "update").length
  const actionCount = entries.filter((entry) => installStatusPolicies[entry.status].summaryKind === "action").length
  const parts = [
    missingCount > 0 ? `${missingCount} 个待安装` : null,
    updateCount > 0 ? `${updateCount} 个待更新` : null,
    actionCount > 0 ? `${actionCount} 个需处理` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "无需操作"
}

function retainBatchErrorsForRetryableEditors(
  errors: Record<string, string>,
  entries: SynapseEditorInstallStatusEntry[],
): Record<string, string> {
  const retryableEditorIds = new Set(
    entries.filter((entry) => canBatchInstall(entry.status)).map((entry) => entry.editorId),
  )
  return Object.fromEntries(Object.entries(errors).filter(([editorId]) => retryableEditorIds.has(editorId)))
}

function removeBatchError(errors: Record<string, string>, editorId: string | undefined): Record<string, string> {
  if (!editorId || !(editorId in errors)) return errors
  const next = { ...errors }
  delete next[editorId]
  return next
}

function SynapseSkillModule() {
  const { config } = useAppConfig()
  const sourceRef = useRef<SynapseSkillInstallerSource | null>(null)
  const sourcePromiseRef = useRef<Promise<SynapseSkillInstallerSource> | null>(null)
  const disposedRef = useRef(false)
  const refreshRequestIdRef = useRef(0)
  const [flowSource, setFlowSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [initialEditor, setInitialEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [statusEntries, setStatusEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [statusError, setStatusError] = useState("")
  const [statusLoading, setStatusLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [batchInstalling, setBatchInstalling] = useState(false)
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const adapters = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "synapse-skill.editors",
  })
  const globalEditors = useMemo(
    () => adapters.filteredAdapters.filter((editor) => editor.supportsGlobal),
    [adapters.filteredAdapters],
  )

  const ensureSource = useCallback(async () => {
    if (sourceRef.current) return sourceRef.current
    sourcePromiseRef.current ??= requireBridgeDomain("synapseSkill").prepareInstallSource()
    try {
      const nextSource = await sourcePromiseRef.current
      if (disposedRef.current) {
        releaseInstallSource(nextSource)
      } else {
        sourceRef.current = nextSource
      }
      return nextSource
    } finally {
      sourcePromiseRef.current = null
    }
  }, [])

  const releaseCurrentSource = useCallback(() => {
    const source = sourceRef.current
    sourceRef.current = null
    if (source) releaseInstallSource(source)
  }, [])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      releaseCurrentSource()
    }
  }, [releaseCurrentSource])

  const refreshStatus = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current
    setStatusLoading(true)
    setStatusError("")
    try {
      const installSource = await ensureSource()
      const result = await inspectGlobalSkillInstallations(installSource)
      if (requestId !== refreshRequestIdRef.current) return
      const globalEntries = result.entries.filter((entry) => entry.scope === "global")
      setStatusEntries(globalEntries)
      setBatchErrors((current) => retainBatchErrorsForRetryableEditors(current, globalEntries))
    } catch (error) {
      if (requestId !== refreshRequestIdRef.current) return
      const message = error instanceof Error ? error.message : "读取安装状态失败"
      logger.error("Failed to load Synapse Skill install status.", error)
      setStatusError(message)
    } finally {
      releaseCurrentSource()
      if (requestId === refreshRequestIdRef.current) {
        setStatusLoading(false)
      }
    }
  }, [ensureSource, releaseCurrentSource])

  useEffect(() => {
    void adapters.load()
    void refreshStatus()
  }, [adapters.load, refreshStatus])

  const openTargetPath = async (targetPath: string) => {
    try {
      await requireBridgeDomain("shell").showItemInFolder(targetPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开目录失败"
      logger.error("Failed to open Synapse Skill target path.", error)
      toast.error(message)
    }
  }

  const openInstallFlowForEditor = async (editorId: SynapseEditorAdapterSummary["id"]) => {
    if (statusLoading) return
    const editor = globalEditors.find((item) => item.id === editorId) ?? null
    if (!editor) return
    const finishTracking = startTrackedOperation({ component: "synapse-skill", eventKey: "synapse-skill.install.prepare" })
    setPreparing(true)
    try {
      const installSource = await ensureSource()
      setInitialEditor(editor)
      setFlowSource(installSource)
      finishTracking("success")
    } catch (error) {
      finishTracking("failure")
      const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
      logger.error("Failed to prepare Synapse Skill source.", error)
      toast.error(message)
    } finally {
      setPreparing(false)
    }
  }

  const globalStatusEntries = statusEntries.filter((entry) => entry.scope === "global")
  const batchableEntries = globalStatusEntries.filter((entry) => canBatchInstall(entry.status))
  const batchActionLabel = getBatchActionLabel(batchableEntries)
  const installSummaryLabel = statusError ? "安装源不可用" : getInstallSummaryLabel(globalStatusEntries)

  const runBatchInstall = async () => {
    if (batchInstalling || batchableEntries.length === 0) return
    const finishTracking = startTrackedOperation({ component: "synapse-skill", eventKey: "synapse-skill.install.batch" })

    setBatchInstalling(true)
    setBatchErrors({})
    try {
      const installSource = await ensureSource()
      const batchResults: SynapseInstallSourceTargetResult[] = []
      for (const group of getBatchGroups(batchableEntries)) {
        const result = await installSourceToEditorTargets({
          mode: group.mode,
          source: installSource,
          targets: group.entries.map((entry) => ({
            editorId: entry.editorId,
            scope: entry.scope,
          })),
        })
        batchResults.push(...result.results)
      }
      const failedResults = batchResults.filter((entry) => entry.status === "failed")
      const warnings = batchResults.flatMap((entry) => (
        entry.status === "installed" && entry.result?.warning ? [entry.result.warning] : []
      ))
      const nextErrors: Record<string, string> = {}
      for (const entry of failedResults) {
        nextErrors[entry.target.editorId] = entry.error ?? "安装失败"
      }
      setBatchErrors(nextErrors)
      finishTracking(failedResults.length > 0 ? "failure" : "success")

      if (failedResults.length === batchResults.length) {
        toast.error("安装失败")
      } else if (failedResults.length > 0) {
        toast.warning(["部分安装失败", ...warnings].join("；"))
      } else if (warnings.length > 0) {
        toast.warning(warnings.join("；"))
      } else {
        toast.success("安装完成")
      }
      await refreshStatus()
    } catch (error) {
      finishTracking("failure")
      const message = error instanceof Error ? error.message : "安装失败"
      logger.error("Failed to batch install Synapse Skill.", error)
      toast.error(message)
    } finally {
      releaseCurrentSource()
      setBatchInstalling(false)
    }
  }

  const openInstallFlow = async () => {
    const finishTracking = startTrackedOperation({ component: "synapse-skill", eventKey: "synapse-skill.install.prepare" })
    setPreparing(true)
    try {
      const installSource = await ensureSource()
      setInitialEditor(null)
      setFlowSource(installSource)
      finishTracking("success")
    } catch (error) {
      finishTracking("failure")
      const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
      logger.error("Failed to prepare Synapse Skill source.", error)
      toast.error(message)
    } finally {
      setPreparing(false)
    }
  }

  if (flowSource) {
    return (
      <SystemAppWindowShell>
        <ScrollArea className="h-full min-h-0">
          <div className="mx-auto w-full max-w-3xl p-3 sm:p-5">
            <Card className="py-0">
              <CardContent className="p-4 sm:p-5">
                <SharedInstallerFlow
                  editors={globalEditors}
                  initialEditor={initialEditor}
                  initialSelection={{ scope: "global" }}
                  kind="skill"
                  mode="page"
                  projects={config.global.projects}
                  source={flowSource}
                  onCancel={() => {
                    releaseCurrentSource()
                    setFlowSource(null)
                    setInitialEditor(null)
                  }}
                  onInstalled={async () => {
                    setBatchErrors((current) => removeBatchError(current, initialEditor?.id))
                    toast.success("安装完成")
                    releaseCurrentSource()
                    setFlowSource(null)
                    setInitialEditor(null)
                    await refreshStatus()
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </SystemAppWindowShell>
    )
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="grid gap-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">全局安装状态</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={refreshStatus}
                  disabled={statusLoading || batchInstalling}
                >
                  {statusLoading ? <Spinner data-icon="inline-start" /> : <RefreshCw />}
                  刷新
                </Button>
              </div>
              {adapters.error ? <p className="text-sm text-destructive">{adapters.error}</p> : null}
              {statusError ? <p className="text-sm text-destructive">{statusError}</p> : null}
              <div className="divide-y divide-border">
                {globalEditors.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">未检测到可安装的编辑器</p>
                ) : globalEditors.map((editor) => {
                  const entry = statusEntries.find((item) => item.editorId === editor.id)
                  const statusPolicy = entry ? installStatusPolicies[entry.status] : null
                  const targetPath = entry?.targetPath ?? null
                  const batchError = batchErrors[editor.id]
                  const showStatusBadge = !statusPolicy || statusPolicy.showBadge
                  return (
                    <div
                      key={editor.id}
                      className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
                    >
                      <EditorIcon editorId={editor.id} className="row-start-1 size-7" />
                      <div className="row-start-1 min-w-0">
                        <p className="truncate text-sm font-medium leading-7">{editor.label}</p>
                      </div>
                      <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-1.5 self-start sm:col-start-3 sm:row-start-1 sm:justify-end">
                        {showStatusBadge ? (
                          <Badge
                            variant={statusBadgeVariant(entry?.status)}
                            className="h-7 min-w-16 px-2.5 text-xs"
                          >
                            {statusPolicy?.label ?? "检测中"}
                          </Badge>
                        ) : null}
                        {entry && statusPolicy?.rowAction ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(statusError) || statusLoading || preparing || batchInstalling}
                            onClick={() => void openInstallFlowForEditor(editor.id)}
                          >
                            {statusPolicy.rowAction === "install" ? <Download data-icon="inline-start" /> : null}
                            {statusPolicy.rowAction === "update" ? <RefreshCw data-icon="inline-start" /> : null}
                            {statusPolicy.rowActionLabel}
                          </Button>
                        ) : null}
                      </div>
                      {targetPath || batchError || entry?.message ? (
                        <div className="col-start-2 grid min-w-0 gap-1 sm:col-span-2">
                          {targetPath ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 max-w-full min-w-0 justify-start bg-transparent px-0 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                              title={targetPath}
                              aria-label={`打开 ${editor.label} Skill 目录`}
                              onClick={() => void openTargetPath(targetPath)}
                            >
                              <span className="truncate">{targetPath}</span>
                            </Button>
                          ) : null}
                          {batchError ? (
                            <p className="break-all text-sm text-destructive" aria-live="polite">
                              {batchError}
                            </p>
                          ) : entry?.message ? (
                            <p className="break-all text-sm text-muted-foreground">{entry.message}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground tabular-nums">{installSummaryLabel}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={batchableEntries.length > 0 ? "outline" : "default"}
                    onClick={() => void openInstallFlow()}
                    disabled={
                      statusLoading
                      || adapters.isLoading
                      || preparing
                      || batchInstalling
                      || Boolean(statusError)
                      || globalEditors.length === 0
                    }
                  >
                    {preparing ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                    安装
                  </Button>
                  {batchableEntries.length > 0 ? (
                    <Button
                      type="button"
                      onClick={() => void runBatchInstall()}
                      disabled={Boolean(statusError) || batchInstalling || statusLoading || adapters.isLoading || preparing}
                    >
                      {batchInstalling ? <Spinner data-icon="inline-start" /> : null}
                      {batchActionLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

export { SynapseSkillModule }
