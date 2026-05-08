import type {
  EditorScanGlobalResult,
  EditorScanRuleItem,
  EditorScanScope,
  EditorScanSkillItem,
} from "@/types/editor-scan"
import type { SynapseEditorId } from "@/types/editor"
import { ScanItemCard } from "./scan-item-card"

type GlobalOverviewProps = {
  result: EditorScanGlobalResult
  contentTab: "skill" | "rule"
  onItemClick?: (
    item: EditorScanSkillItem | EditorScanRuleItem,
    type: "skill" | "rule",
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
    },
  ) => void
}

function GlobalOverview({ result, contentTab, onItemClick }: GlobalOverviewProps) {
  if (contentTab === "skill") {
    if (result.skills.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          未检测到全局 skill
        </p>
      )
    }

    return (
      <section>
        {result.duplicateSkillNames.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            兼容目录存在重复 Skill，已优先显示主目录版本：{result.duplicateSkillNames.join(", ")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 p-[3px]">
          {result.skills.map((skill) => (
            <ScanItemCard
              key={skill.path}
              name={skill.name}
              path={skill.path}
              source={skill.source}
              preview={skill.preview}
              onClick={() => onItemClick?.(skill, "skill", {
                editorId: result.editorId,
                editorLabel: result.editorLabel,
                scope: "global",
              })}
            />
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          共有 {result.skills.length} 个全局 Skill
        </p>
      </section>
    )
  }

  if (!result.rulesSupported) {
    return (
      <p className="text-sm text-muted-foreground">
        {result.editorLabel} 暂不支持全局规则目录
      </p>
    )
  }

  if (result.rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        未检测到全局规则
      </p>
    )
  }

  return (
    <section>
      <div className="grid grid-cols-2 gap-2 p-[3px]">
        {result.rules.map((rule) => (
          <ScanItemCard
            key={`${rule.path}-${rule.name}`}
            name={rule.name}
            path={rule.path}
            source={rule.source}
            preview={rule.preview}
            metadata={rule.metadata}
            onClick={() => onItemClick?.(rule, "rule", {
              editorId: result.editorId,
              editorLabel: result.editorLabel,
              scope: "global",
            })}
          />
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        共有 {result.rules.length} 个全局规则
      </p>
    </section>
  )
}

export { GlobalOverview }
