import { useState } from "react"
import { toast } from "sonner"
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
import { EditorIcon } from "@/components/editor-icon"
import type { SynapseEditorId } from "@/types/editor"
import { editorDefinitions } from "@/definitions/generated/renderer-registry"
import { useInstallStatus, useUninstallFromEditor } from "@/modules/content/contexts/install-status-context"
import { LoaderCircle } from "lucide-react"
import type { InstallStatusEntry } from "@/types/install-status"

const editorLabelMap = new Map<string, string>(
  editorDefinitions.map((def) => [def.id, def.label]),
)

function getEditorLabel(editorId: string): string {
  return editorLabelMap.get(editorId) ?? editorId
}

function EditorBadge({
  contentId,
  editorId,
}: {
  contentId: string
  editorId: SynapseEditorId
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const uninstall = useUninstallFromEditor()
  const label = getEditorLabel(editorId)

  async function handleUninstall() {
    setBusy(true)
    try {
      const result = await uninstall(contentId, editorId)
      setOpen(false)
      if (result.warning) toast.warning(result.warning)
    } catch {
      toast.error("卸载失败，请重试。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded hover:opacity-80 transition-opacity"
          title={label}
        >
          <EditorIcon editorId={editorId} className="size-5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <EditorIcon editorId={editorId} className="size-5" />
            <span>从 {label} 移到废纸篓？</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            可从系统废纸篓恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleUninstall()
            }}
            disabled={busy}
            className="gap-2"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {busy ? "正在移到废纸篓..." : "移到废纸篓"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function EditorInstallBadges({ contentId }: { contentId: string }) {
  const entries = useInstallStatus(contentId)
  const hasUpdate = entries.some((entry) => entry.scope === "global" && entry.status === "needs_update")

  if (entries.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {entries.map((entry) => (
        entry.scope === "global" ? (
          <EditorBadge
            key={`${entry.scope}:${entry.editorId}`}
            contentId={contentId}
            editorId={entry.editorId}
          />
        ) : (
          <ProjectEditorBadge
            key={`${entry.scope}:${entry.editorId}:${entry.projectPath ?? ""}`}
            entry={entry}
          />
        )
      ))}
      {hasUpdate ? (
        <Badge variant="secondary" title="已安装版本落后">
          可更新
        </Badge>
      ) : null}
    </div>
  )
}

function ProjectEditorBadge({ entry }: { entry: InstallStatusEntry }) {
  const label = getEditorLabel(entry.editorId)
  const projectName = entry.projectName ?? "项目"
  return (
    <span
      className="flex size-5 items-center justify-center rounded"
      title={`${label} · ${projectName}`}
    >
      <EditorIcon editorId={entry.editorId} className="size-5" />
    </span>
  )
}

export { EditorInstallBadges }
