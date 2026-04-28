import { FolderOpen, LoaderCircle, RefreshCw } from "lucide-react"
import type { ComponentProps } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusValue,
} from "@/types/editor-install-status"

type EditorInstallStatusPanelProps = {
  entries: SynapseEditorInstallStatusEntry[]
  error: string | null
  isLoading: boolean
  onOpenInstallTarget: (entry: SynapseEditorInstallStatusEntry) => void
  onRefresh: () => void
}

const statusLabels: Record<SynapseEditorInstallStatusValue, string> = {
  conflict: "冲突",
  external_same_name: "外部同名",
  installed: "已安装",
  needs_update: "需更新",
  not_installed: "未安装",
  unavailable: "不可用",
  unsupported: "不支持",
}

function canWriteStatus(status: SynapseEditorInstallStatusValue): boolean {
  return status === "not_installed" || status === "needs_update"
}

function getScopeLabel(entry: SynapseEditorInstallStatusEntry): string {
  if (entry.scope === "global") {
    return "全局"
  }

  return entry.projectName ?? "项目"
}

function getStatusVariant(status: SynapseEditorInstallStatusValue): ComponentProps<typeof Badge>["variant"] {
  if (status === "conflict") {
    return "destructive"
  }

  if (status === "installed") {
    return "default"
  }

  if (status === "needs_update" || status === "unsupported") {
    return "secondary"
  }

  return "outline"
}

function openTargetPath(path: string) {
  getSynapseBridge()?.shell.showItemInFolder(path)
}

function EditorInstallStatusPanel({
  entries,
  error,
  isLoading,
  onOpenInstallTarget,
  onRefresh,
}: EditorInstallStatusPanelProps) {
  if (error) {
    return (
      <section className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">安装状态</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
          >
            <RefreshCw />
            重试
          </Button>
        </div>
        <p className="text-sm text-destructive">{error}</p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">安装状态</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={onRefresh}
        >
          {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          刷新
        </Button>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const canWrite = canWriteStatus(entry.status)
          const targetPath = entry.targetPath

          return (
            <Collapsible
              key={`${entry.editorId}-${entry.scope}-${entry.projectId ?? "global"}-${entry.status}`}
              defaultOpen
              className="rounded-lg border border-border"
            >
              <div className="flex items-center gap-2 p-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{entry.editorLabel}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {getScopeLabel(entry)}
                      </span>
                    </span>
                    <Badge variant={getStatusVariant(entry.status)}>
                      {statusLabels[entry.status]}
                    </Badge>
                  </button>
                </CollapsibleTrigger>

                {targetPath ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openTargetPath(targetPath)}
                  >
                    <FolderOpen />
                    打开
                  </Button>
                ) : null}

                {canWrite ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpenInstallTarget(entry)}
                  >
                    {entry.status === "needs_update" ? "更新" : "安装"}
                  </Button>
                ) : null}
              </div>

              <CollapsibleContent>
                <div className="space-y-2 border-t border-border px-3 py-3 text-sm text-muted-foreground">
                  {targetPath ? <p className="break-all">{targetPath}</p> : null}
                  {entry.message ? <p>{entry.message}</p> : null}
                  {!targetPath && !entry.message ? <p>无目标路径</p> : null}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </section>
  )
}

export { EditorInstallStatusPanel }
export type { EditorInstallStatusPanelProps }
