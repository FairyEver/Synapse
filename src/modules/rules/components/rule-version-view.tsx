import { InlineNotice } from "@/components/inline-notice"
import { MarkdownViewer, type MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { SynapseContentViewMode } from "@/types/content"

type RuleVersionViewProps = {
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: SynapseLoadedContentVersion<"rule">
}

function RuleVersionView({ mode, surface, version }: RuleVersionViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {version.deleted ? (
        <InlineNotice message="该规则已被删除。" tone="destructive" />
      ) : null}

      <MarkdownViewer content={version.content} mode={mode} showTabs={false} surface={surface} />
    </div>
  )
}

export { RuleVersionView }
