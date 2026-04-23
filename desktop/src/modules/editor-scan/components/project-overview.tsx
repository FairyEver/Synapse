import { useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { SynapseEditorId } from "@/types/editor"
import type { EditorScanProjectResult, EditorScanRuleItem } from "@/types/editor-scan"
import { ScanItemCard } from "./scan-item-card"

type ProjectOverviewProps = {
  projects: EditorScanProjectResult[]
  selectedEditorId: SynapseEditorId
  selectedEditorLabel: string
  contentTab: "skill" | "rule"
}

function ProjectOverview({
  projects,
  selectedEditorId,
  selectedEditorLabel,
  contentTab,
}: ProjectOverviewProps) {
  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        const editorEntry = project.editors.find(
          (e) => e.editorId === selectedEditorId,
        )
        return { project, editorEntry }
      })
      .filter(({ project, editorEntry }) => {
        if (!project.pathExists) return true
        if (!editorEntry) return false
        if (contentTab === "skill") return editorEntry.skills.length > 0
        return editorEntry.rules.length > 0
      })
  }, [projects, selectedEditorId, contentTab])

  if (filteredProjects.length === 0) {
    const label = contentTab === "skill" ? "skill" : "规则"
    return (
      <p className="text-sm text-muted-foreground">
        已配置的项目中未检测到 {selectedEditorLabel} 的{label}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {filteredProjects.map(({ project, editorEntry }) => {
        const items = contentTab === "skill"
          ? editorEntry?.skills ?? []
          : editorEntry?.rules ?? []

        return (
          <Collapsible key={project.projectPath} data-track="editor-scan-project">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                disabled={!project.pathExists}
              >
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90" />
                <span className="truncate">项目: {project.projectName}</span>
                {!project.pathExists ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                    路径不存在
                  </Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </button>
            </CollapsibleTrigger>
            {project.pathExists && items.length > 0 ? (
              <CollapsibleContent>
                <div className="ml-6 mt-1">
                  <div className="overflow-hidden rounded-lg border border-border">
                    {items.map((item) => (
                      <ScanItemCard
                        key={`${item.path}-${item.name}`}
                        name={item.name}
                        path={item.path}
                        source={item.source}
                        preview={item.preview}
                        metadata={contentTab === "rule" ? (item as EditorScanRuleItem).metadata : undefined}
                      />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            ) : null}
          </Collapsible>
        )
      })}
    </div>
  )
}

export { ProjectOverview }
