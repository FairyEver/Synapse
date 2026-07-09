import { useCallback, useEffect, useMemo, useState } from "react"
import { MoreHorizontal, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "../../../src/app-shell/config"
import { resolveEditorInstallStatus } from "../../../src/app-shell/editor-install-status"
import { installSourceToEditorTargets } from "../../../src/app-shell/installers"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { EditorIcon } from "../../../src/components/editor-icon"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../src/components/ui/dropdown-menu"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseEditorAdapterSummary } from "../../../src/types/editor"
import type { SynapseEditorInstallStatusEntry } from "../../../src/types/editor-install-status"
import type { SynapseSkillInstallerSource } from "../../../src/types/installers"

const logger = createRendererLogger("synapse-skill.app")

const statusLabels = {
  conflict: "冲突",
  external_same_name: "外部同名",
  installed: "已安装",
  needs_update: "需更新",
  not_installed: "未安装",
  unavailable: "不可用",
  unsupported: "不支持",
} as const

function statusBadgeVariant(status: SynapseEditorInstallStatusEntry["status"] | undefined) {
  if (status === "installed") return "default"
  if (status === "needs_update") return "secondary"
  if (status === "conflict") return "destructive"
  return "outline"
}

function canBatchInstall(status: SynapseEditorInstallStatusEntry["status"] | undefined): boolean {
  return status === "not_installed" || status === "needs_update"
}

function canOpenSingleTargetFlow(status: SynapseEditorInstallStatusEntry["status"] | undefined): boolean {
  return status === "not_installed"
    || status === "needs_update"
    || status === "conflict"
    || status === "external_same_name"
}

function getPrimaryBatchLabel(entries: SynapseEditorInstallStatusEntry[]): string {
  const hasMissing = entries.some((entry) => entry.status === "not_installed")
  const hasUpdate = entries.some((entry) => entry.status === "needs_update")
  if (hasMissing && hasUpdate) return "安装并更新"
  if (hasUpdate) return "更新已安装项"
  if (hasMissing) return "安装缺失项"
  return "全部已安装"
}

function getBatchMode(entries: SynapseEditorInstallStatusEntry[]): "install" | "update" {
  return entries.some((entry) => entry.status === "needs_update") ? "update" : "install"
}

function getRowActionLabel(status: SynapseEditorInstallStatusEntry["status"]): string {
  if (status === "needs_update") return "更新"
  if (status === "not_installed") return "安装"
  return "处理"
}

function SynapseSkillModule() {
  const { config } = useAppConfig()
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [flowSource, setFlowSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [initialEditor, setInitialEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [statusEntries, setStatusEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [statusError, setStatusError] = useState("")
  const [statusLoading, setStatusLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [batchInstalling, setBatchInstalling] = useState(false)
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
    if (source) return source
    const nextSource = await requireBridgeDomain("synapseSkill").prepareInstallSource()
    setSource(nextSource)
    return nextSource
  }, [source])

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError("")
    try {
      const installSource = await ensureSource()
      const result = await resolveEditorInstallStatus({
        contentId: "synapse-skill",
        contentName: "synapse-skill",
        contentType: "skill",
        projects: [],
        sourceFingerprint: installSource.sourceFingerprint,
        title: "Synapse Skill",
      })
      setStatusEntries(result.entries.filter((entry) => entry.scope === "global"))
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取安装状态失败"
      logger.error("Failed to load Synapse Skill install status.", error)
      setStatusError(message)
    } finally {
      setStatusLoading(false)
    }
  }, [ensureSource])

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
    const editor = globalEditors.find((item) => item.id === editorId) ?? null
    if (!editor) return
    setPreparing(true)
    try {
      const installSource = await ensureSource()
      setInitialEditor(editor)
      setFlowSource(installSource)
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
      logger.error("Failed to prepare Synapse Skill source.", error)
      toast.error(message)
    } finally {
      setPreparing(false)
    }
  }

  const globalStatusEntries = statusEntries.filter((entry) => entry.scope === "global")
  const batchableEntries = globalStatusEntries.filter((entry) => canBatchInstall(entry.status))
  const batchLabel = getPrimaryBatchLabel(globalStatusEntries)

  const runBatchInstall = async () => {
    if (batchInstalling || batchableEntries.length === 0) return

    setBatchInstalling(true)
    try {
      const installSource = await ensureSource()
      const result = await installSourceToEditorTargets({
        mode: getBatchMode(batchableEntries),
        source: installSource,
        targets: batchableEntries.map((entry) => ({
          editorId: entry.editorId,
          scope: "global",
        })),
      })
      const failedCount = result.results.filter((entry) => entry.status === "failed").length
      if (failedCount === 0) {
        toast.success("安装完成")
      } else if (failedCount === result.results.length) {
        toast.error("安装失败")
      } else {
        toast.warning("部分安装失败")
      }
      await refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : "安装失败"
      logger.error("Failed to batch install Synapse Skill.", error)
      toast.error(message)
    } finally {
      setBatchInstalling(false)
    }
  }

  if (flowSource && initialEditor) {
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
                    setFlowSource(null)
                    setInitialEditor(null)
                  }}
                  onInstalled={async () => {
                    toast.success("安装完成")
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
                <Button type="button" variant="ghost" size="sm" onClick={refreshStatus} disabled={statusLoading}>
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
                  return (
                    <div key={editor.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <EditorIcon editorId={editor.id} className="size-7" />
                          <p className="truncate font-medium">{editor.label}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={statusBadgeVariant(entry?.status)}>
                            {entry ? statusLabels[entry.status] : "检测中"}
                          </Badge>
                          {entry && canOpenSingleTargetFlow(entry.status) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={batchInstalling || preparing}
                              onClick={() => void openInstallFlowForEditor(editor.id)}
                            >
                              {getRowActionLabel(entry.status)}
                            </Button>
                          ) : null}
                          {entry?.status === "installed" ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`${editor.label} 更多操作`}
                                  disabled={batchInstalling || preparing}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => void openInstallFlowForEditor(editor.id)}>
                                  重新安装
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </div>
                      {entry?.targetPath ? (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto min-w-0 justify-start p-0 text-left text-sm text-muted-foreground hover:text-foreground"
                          onClick={() => void openTargetPath(entry.targetPath)}
                        >
                          <span className="break-all">{entry.targetPath}</span>
                        </Button>
                      ) : entry?.message ? (
                        <p className="break-all text-sm text-muted-foreground">{entry.message}</p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-center border-t pt-4">
                <Button
                  type="button"
                  onClick={() => void runBatchInstall()}
                  disabled={
                    batchInstalling
                    || statusLoading
                    || adapters.isLoading
                    || batchableEntries.length === 0
                  }
                >
                  {batchInstalling ? <Spinner data-icon="inline-start" /> : null}
                  {batchLabel}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

export { SynapseSkillModule }
