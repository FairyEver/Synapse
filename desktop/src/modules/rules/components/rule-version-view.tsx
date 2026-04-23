import { ContentVersionView } from "@/modules/content/components/content-version-view"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseContentViewMode } from "@/types/content"

type RuleVersionViewProps = {
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: SynapseLoadedContentVersion<"rule">
}

function RuleVersionView({ mode, surface, version }: RuleVersionViewProps) {
  return (
    <ContentVersionView
      deletedMessage="该规则已被删除。"
      mode={mode}
      surface={surface}
      version={version}
    />
  )
}

export { RuleVersionView }
