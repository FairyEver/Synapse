import type {
  EditorScanGlobalResult,
  EditorScanRuleItem,
  EditorScanScope,
  EditorScanSkillItem,
} from "@/types/editor-scan"
import type { SynapseEditorId } from "@/types/editor"
import { ScanItemCard } from "./scan-item-card"
import { prioritizeSynapseSkills } from "../lib/skill-order"

type GlobalOverviewProps = {
  result: EditorScanGlobalResult
  contentTab: "skill" | "rule"
  selectedSkillKeys?: Set<string>
  buildSkillKey?: (input: { path: string; scope: EditorScanScope }) => string
  onItemClick?: (
    item: EditorScanSkillItem | EditorScanRuleItem,
    type: "skill" | "rule",
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
    },
  ) => void
  onSkillSelectionChange?: (
    item: EditorScanSkillItem,
    context: {
      editorId: SynapseEditorId
      editorLabel: string
      scope: EditorScanScope
    },
    selected: boolean,
  ) => void
}

function GlobalOverview({
  result,
  contentTab,
  selectedSkillKeys,
  buildSkillKey,
  onItemClick,
  onSkillSelectionChange,
}: GlobalOverviewProps) {
  if (contentTab === "skill") {
    const skills = prioritizeSynapseSkills(result.skills)

    if (result.skillScanError) {
      return (
        <p className="text-sm text-destructive">
          {result.skillScanError}
        </p>
      )
    }

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
        <div className="grid grid-cols-2 gap-2">
          {skills.map((skill) => {
            const key = buildSkillKey?.({ path: skill.path, scope: "global" }) ?? skill.path

            return (
              <ScanItemCard
                key={skill.path}
                name={skill.name}
                path={skill.path}
                source={skill.source}
                preview={skill.preview}
                selectable={Boolean(onSkillSelectionChange)}
                selected={selectedSkillKeys?.has(key) ?? false}
                onSelectionChange={(selected) => onSkillSelectionChange?.(skill, {
                  editorId: result.editorId,
                  editorLabel: result.editorLabel,
                  scope: "global",
                }, selected)}
                onClick={() => onItemClick?.(skill, "skill", {
                  editorId: result.editorId,
                  editorLabel: result.editorLabel,
                  scope: "global",
                })}
              />
            )
          })}
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
      <div className="grid grid-cols-2 gap-2">
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
