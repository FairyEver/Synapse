import { useMemo } from "react"
import { FolderKanban } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { SynapseEditorId } from "@/types/editor"
import type {
  EditorScanProjectResult,
  EditorScanRuleItem,
  EditorScanScope,
  EditorScanSkillItem,
} from "@/types/editor-scan"
import { ScanItemCard } from "./scan-item-card"

type ProjectOverviewProps = {
  projects: EditorScanProjectResult[]
  selectedEditorId: SynapseEditorId
  selectedEditorLabel: string
  contentTab: "skill" | "rule"
  onItemClick?: (
    item: EditorScanSkillItem | EditorScanRuleItem,
    type: "skill" | "rule",
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
      projectName: string
    },
  ) => void
}

function ProjectOverview({
  projects,
  selectedEditorId,
  selectedEditorLabel,
  contentTab,
  onItemClick,
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
    <div className="flex flex-col gap-5">
      {filteredProjects.map(({ project, editorEntry }) => {
        const items = contentTab === "skill"
          ? editorEntry?.skills ?? []
          : editorEntry?.rules ?? []

        const label = contentTab === "skill" ? "Skill" : "规则"

        return (
          <section key={project.projectPath}>
            <div className="mb-3 flex items-center gap-2">
              <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">
                {project.projectName}
              </h4>
              {!project.pathExists && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  路径不存在
                </Badge>
              )}
            </div>
            {project.pathExists && items.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-2 p-[3px]">
                  {items.map((item) => (
                    <ScanItemCard
                      key={`${item.path}-${item.name}`}
                      name={item.name}
                      path={item.path}
                      source={item.source}
                      preview={item.preview}
                      metadata={"metadata" in item ? item.metadata : undefined}
                      onClick={() => onItemClick?.(item, contentTab, {
                        editorId: selectedEditorId,
                        editorLabel: selectedEditorLabel,
                        scope: "project",
                        projectName: project.projectName,
                      })}
                    />
                  ))}
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  共有 {items.length} 个{label}
                </p>
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

export { ProjectOverview }
