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
    <ContentVersionView
      deletedMessage="该 Skill 已被删除。"
      mode={mode}
      surface={surface}
      version={version}
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">附件</p>
        {version.attachments.length > 0 ? (
          <div className="rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {version.attachments.map((attachment) => (
                <li
                  key={`${attachment.sha256}:${attachment.originalName}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 break-all text-foreground">
                    {attachment.originalName}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {attachment.size} B
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">没有附件。</p>
        )}
      </div>
    </ContentVersionView>
  )
}

export { SkillVersionView }
