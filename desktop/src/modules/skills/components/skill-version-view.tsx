import { ContentVersionView } from "@/modules/content/components/content-version-view"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseContentViewMode } from "@/types/content"

type SkillVersionViewProps = {
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: SynapseLoadedContentVersion<"skill">
}

function SkillVersionView({ mode, surface, version }: SkillVersionViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {version.description ? (
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">描述</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
            {version.description}
          </p>
        </div>
      ) : null}

      <ContentVersionView
        deletedMessage="该 Skill 已被删除。"
        mode={mode}
        surface={surface}
        version={version}
      />
    </div>
  )
}

export { SkillVersionView }
