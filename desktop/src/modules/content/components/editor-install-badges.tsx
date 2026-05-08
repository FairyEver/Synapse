import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { SynapseEditorId } from "@/types/editor"
import { useInstallStatus, useUninstallFromEditor } from "@/modules/content/contexts/install-status-context"

const EDITOR_META: Record<string, { abbr: string; label: string; bgColor: string }> = {
  "claude-code": { abbr: "CC", label: "Claude Code", bgColor: "bg-[#d97757]" },
  "cursor": { abbr: "Cu", label: "Cursor", bgColor: "bg-[#2563eb]" },
  "codex": { abbr: "Cx", label: "Codex", bgColor: "bg-[#10b981]" },
  "windsurf": { abbr: "Ws", label: "Windsurf", bgColor: "bg-[#8b5cf6]" },
  "antigravity": { abbr: "Ag", label: "Antigravity", bgColor: "bg-[#f59e0b]" },
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
  const meta = EDITOR_META[editorId] ?? { abbr: editorId.slice(0, 2).toUpperCase(), label: editorId, bgColor: "bg-muted" }

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex size-5 items-center justify-center rounded text-[9px] font-bold text-white ${meta.bgColor} hover:opacity-90 transition-opacity`}
          title={meta.label}
        >
          {meta.abbr}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" side="top">
        <div className="flex items-center gap-2 px-1 py-0.5">
          <span className="text-xs font-medium">{meta.label}</span>
          <span className="text-[10px] text-muted-foreground">global</span>
        </div>
        <Separator className="my-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start text-xs text-destructive hover:text-destructive"
          disabled={busy}
          onClick={handleUninstall}
        >
          {busy ? "卸载中..." : "卸载"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function EditorInstallBadges({ contentId }: { contentId: string }) {
  const editors = useInstallStatus(contentId)

  if (editors.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 border-t border-border pt-2 mt-2">
      {editors.map((editorId) => (
        <EditorBadge key={editorId} contentId={contentId} editorId={editorId} />
      ))}
    </div>
  )
}

export { EditorInstallBadges }
