import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "../../../src/app-shell/config"
import { resolveEditorInstallStatus } from "../../../src/app-shell/editor-install-status"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { EditorIcon } from "../../../src/components/editor-icon"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseEditorInstallStatusEntry } from "../../../src/types/editor-install-status"
import type { SynapseSkillInstallerSource } from "../shared/schema"

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
  if (status === "conflict") return "destructive"
  return "outline"
}

function SynapseSkillModule() {
  const { config } = useAppConfig()
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [statusEntries, setStatusEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [statusError, setStatusError] = useState("")
  const [statusLoading, setStatusLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const adapters = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "synapse-skill.editors",
  })
  const globalEditors = useMemo(
    () => adapters.filteredAdapters.filter((editor) => editor.supportsGlobal),
    [adapters.filteredAdapters],
  )

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError("")
    try {
      const result = await resolveEditorInstallStatus({
        contentId: "synapse-skill",
        contentName: "synapse-skill",
        contentType: "skill",
        projects: [],
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
  }, [])

  useEffect(() => {
    void adapters.load()
    void refreshStatus()
  }, [adapters.load, refreshStatus])

  const startInstall = async () => {
    setPreparing(true)
    try {
      const nextSource = await requireBridgeDomain("synapseSkill").prepareInstallSource()
      setSource(nextSource)
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
      logger.error("Failed to prepare Synapse Skill source.", error)
      toast.error(message)
    } finally {
      setPreparing(false)
    }
  }

  if (source) {
    return (
      <SystemAppWindowShell>
        <ScrollArea className="h-full min-h-0">
          <div className="mx-auto w-full max-w-3xl p-3 sm:p-5">
            <Card className="py-0">
              <CardContent className="p-4 sm:p-5">
                <SharedInstallerFlow
                  editors={globalEditors}
                  kind="skill"
                  mode="page"
                  projects={config.global.projects}
                  source={source}
                  onCancel={() => setSource(null)}
                  onInstalled={async () => {
                    toast.success("安装完成")
                    setSource(null)
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
                    <div key={editor.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <EditorIcon editorId={editor.id} className="size-7" />
                          <p className="truncate font-medium">{editor.label}</p>
                        </div>
                        <Badge variant={statusBadgeVariant(entry?.status)}>
                          {entry ? statusLabels[entry.status] : "检测中"}
                        </Badge>
                      </div>
                      {entry?.targetPath || entry?.message ? (
                        <p className="break-all text-sm text-muted-foreground">{entry.targetPath ?? entry.message}</p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-center border-t pt-4">
                <Button type="button" onClick={startInstall} disabled={preparing || adapters.isLoading}>
                  {preparing ? <Spinner data-icon="inline-start" /> : null}
                  安装 Synapse Skill
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
