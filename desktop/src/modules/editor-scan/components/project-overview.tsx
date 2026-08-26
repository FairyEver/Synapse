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
import { prioritizeSynapseSkills } from "../lib/skill-order"

type ProjectOverviewProps = {
  projects: EditorScanProjectResult[]
  selectedEditorId: SynapseEditorId
  selectedEditorLabel: string
  contentTab: "skill" | "rule"
  selectedSkillKeys?: Set<string>
  buildSkillKey?: (input: {
    path: string
    scope: EditorScanScope
    projectPath?: string
  }) => string
  onItemClick?: (
    item: EditorScanSkillItem | EditorScanRuleItem,
    type: "skill" | "rule",
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
      projectName: string
      projectPath: string
    },
  ) => void
  onSkillSelectionChange?: (
    item: EditorScanSkillItem,
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
      projectName: string
      projectPath: string
    },
    selected: boolean,
  ) => void
}

function ProjectOverview({
  projects,
  selectedEditorId,
  selectedEditorLabel,
  contentTab,
  selectedSkillKeys,
  buildSkillKey,
  onItemClick,
  onSkillSelectionChange,
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
        if (contentTab === "skill") return editorEntry.skills.length > 0 || Boolean(editorEntry.skillScanError)
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
    <div className="flex flex-col gap-2">
      {filteredProjects.map(({ project, editorEntry }) => {
        const items = contentTab === "skill"
          ? prioritizeSynapseSkills(editorEntry?.skills ?? [])
          : editorEntry?.rules ?? []

        const label = contentTab === "skill" ? "Skill" : "规则"

        return (
          <section key={project.projectPath}>
            <div className="mb-2 flex items-center gap-2">
              <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">
                {project.projectName}
              </h4>
              {!project.pathExists && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  路径不存在
                </Badge>
              )}
            </div>
            {project.pathExists && contentTab === "skill" && editorEntry?.skillScanError ? (
              <p className="text-sm text-destructive">
                {editorEntry.skillScanError}
              </p>
            ) : null}
            {project.pathExists && items.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => {
                    const selectionKey = buildSkillKey?.({
                      path: item.path,
                      projectPath: project.projectPath,
                      scope: "project",
                    }) ?? `${project.projectPath}:${item.path}`

                    return (
                      <ScanItemCard
                        key={`${item.path}-${item.name}`}
                        name={item.name}
                        path={item.path}
                        source={item.source}
                        preview={item.preview}
                        metadata={"metadata" in item ? item.metadata : undefined}
                        selectable={contentTab === "skill" && Boolean(onSkillSelectionChange)}
                        selected={selectedSkillKeys?.has(selectionKey) ?? false}
                        onSelectionChange={(selected) => {
                          if (contentTab !== "skill") return
                          onSkillSelectionChange?.(item as EditorScanSkillItem, {
                            editorId: selectedEditorId,
                            editorLabel: selectedEditorLabel,
                            scope: "project",
                            projectName: project.projectName,
                            projectPath: project.projectPath,
                          }, selected)
                        }}
                        onClick={() => onItemClick?.(item, contentTab, {
                          editorId: selectedEditorId,
                          editorLabel: selectedEditorLabel,
                          scope: "project",
                          projectName: project.projectName,
                          projectPath: project.projectPath,
                        })}
                      />
                    )
                  })}
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
