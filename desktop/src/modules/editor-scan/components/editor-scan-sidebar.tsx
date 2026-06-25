import { useMemo } from "react"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { EditorIcon } from "@/components/editor-icon"
import { EDITOR_ORDER, getEditorLabel } from "@/lib/editor-registry"
import type { SynapseEditorId } from "@/types/editor"
import type { EditorScanResult } from "@/types/editor-scan"

type EditorScanSidebarProps = {
  data: EditorScanResult | null
  selectedEditorId: SynapseEditorId
  onSelect: (editorId: SynapseEditorId) => void
}

type EditorSummary = {
  editorId: SynapseEditorId
  label: string
  detected: boolean
  skillCount: number
  ruleCount: number
}

function EditorScanSidebar({
  data,
  selectedEditorId,
  onSelect,
}: EditorScanSidebarProps) {
  const summaries = useMemo((): EditorSummary[] => {
    if (!data) {
      return EDITOR_ORDER.map((id) => ({
        editorId: id,
        label: getEditorLabel(id),
        detected: false,
        skillCount: 0,
        ruleCount: 0,
      }))
    }

    return EDITOR_ORDER.map((editorId) => {
      const global = data.global.find((g) => g.editorId === editorId)
      let skillCount = global?.skills.length ?? 0
      let ruleCount = global?.rules.length ?? 0

      for (const project of data.projects) {
        const entry = project.editors.find((e) => e.editorId === editorId)
        if (entry) {
          skillCount += entry.skills.length
          ruleCount += entry.rules.length
        }
      }

      return {
        editorId,
        label: global?.editorLabel ?? editorId,
        detected: global?.status === "detected",
        skillCount,
        ruleCount,
      }
    })
  }, [data])

  return (
    <ModuleSidebar variant="bare">
      <div data-editor-scan-sidebar-heading className="px-2 py-1 text-xs font-medium text-muted-foreground">
        编辑器
      </div>
      <ModuleSidebarList data-track="editor-scan-sidebar-list">
        {summaries.map((s) => (
          <ModuleSidebarItem
            key={s.editorId}
            active={s.editorId === selectedEditorId}
            data-track="editor-scan-editor-select"
            trackValue={s.editorId}
            onClick={() => onSelect(s.editorId)}
            iconElement={<EditorIcon editorId={s.editorId} className="size-4" />}
            trailing={
              s.detected ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.skillCount + s.ruleCount}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )
            }
          >
            {s.label}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { EditorScanSidebar }
