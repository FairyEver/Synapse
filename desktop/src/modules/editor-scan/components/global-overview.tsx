import type { EditorScanGlobalResult } from "@/types/editor-scan"
import { ScanItemCard } from "./scan-item-card"

type GlobalOverviewProps = {
  result: EditorScanGlobalResult
  contentTab: "skill" | "rule"
}

function GlobalOverview({ result, contentTab }: GlobalOverviewProps) {
  if (contentTab === "skill") {
    return (
      <section>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          全局 Skill ({result.skills.length})
        </h3>
        {result.skills.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {result.skills.map((skill) => (
              <ScanItemCard
                key={skill.path}
                name={skill.name}
                path={skill.path}
                source={skill.source}
                preview={skill.preview}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            未检测到全局 skill
          </p>
        )}
      </section>
    )
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {result.rulesSupported
          ? `全局规则 (${result.rules.length})`
          : "全局规则"}
      </h3>
      {!result.rulesSupported ? (
        <p className="text-sm text-muted-foreground">
          {result.editorLabel} 暂不支持全局规则目录
        </p>
      ) : result.rules.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {result.rules.map((rule) => (
            <ScanItemCard
              key={`${rule.path}-${rule.name}`}
              name={rule.name}
              path={rule.path}
              source={rule.source}
              preview={rule.preview}
              metadata={rule.metadata}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          未检测到全局规则
        </p>
      )}
    </section>
  )
}

export { GlobalOverview }
