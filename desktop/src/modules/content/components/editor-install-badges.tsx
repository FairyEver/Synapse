import { useState } from "react"
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
import { EditorIcon } from "@/components/editor-icon"
import type { SynapseEditorId } from "@/types/editor"
import { editorDefinitions } from "@/definitions/generated/renderer-registry"
import { useInstallStatus, useUninstallFromEditor } from "@/modules/content/contexts/install-status-context"
import { LoaderCircle } from "lucide-react"

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
      await uninstall(contentId, editorId)
      setOpen(false)
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
            <span>从 {label} 卸载</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            该内容已安装到 {label} 编辑器的全局设置中。确认要删除吗？
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
            {busy ? "删除中..." : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function EditorInstallBadges({ contentId }: { contentId: string }) {
  const editors = useInstallStatus(contentId)

  if (editors.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 pt-2">
      {editors.map((editorId) => (
        <EditorBadge key={editorId} contentId={contentId} editorId={editorId} />
      ))}
    </div>
  )
}

export { EditorInstallBadges }
