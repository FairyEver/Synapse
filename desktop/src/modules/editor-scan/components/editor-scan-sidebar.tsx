import { useMemo } from "react"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { getEditorIconSrc, EDITOR_ICON_CLIP_STYLE } from "@/lib/editor-icons"
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
      <ModuleSidebarList>
        {summaries.map((s) => {
          const iconSrc = getEditorIconSrc(s.editorId)
          return (
            <ModuleSidebarItem
              key={s.editorId}
              active={s.editorId === selectedEditorId}
              onClick={() => onSelect(s.editorId)}
              iconElement={
                iconSrc ? (
                  <img src={iconSrc} alt={s.label} className="size-4 shrink-0" style={EDITOR_ICON_CLIP_STYLE} />
                ) : null
              }
              trailing={
                s.detected ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {s.skillCount + s.ruleCount}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )
              }
            >
              {s.label}
            </ModuleSidebarItem>
          )
        })}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { EditorScanSidebar }
