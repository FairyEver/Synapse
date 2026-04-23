import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import type { SynapseEditorId } from "@/types/editor"
import type { EditorScanProjectResult } from "@/types/editor-scan"
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
    <div className="flex flex-col gap-5">
      {filteredProjects.map(({ project, editorEntry }) => {
        const items = contentTab === "skill"
          ? editorEntry?.skills ?? []
          : editorEntry?.rules ?? []

        return (
          <section key={project.projectPath}>
            <div className="mb-3 flex items-center gap-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {project.projectName}
              </h4>
              {!project.pathExists ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  路径不存在
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground/60">
                  {items.length}
                </span>
              )}
            </div>
            {project.pathExists && items.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <ScanItemCard
                    key={item.path}
                    name={item.name}
                    path={item.path}
                    source={item.source}
                    preview={item.preview}
                    metadata={"metadata" in item ? item.metadata : undefined}
                  />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

export { ProjectOverview }
