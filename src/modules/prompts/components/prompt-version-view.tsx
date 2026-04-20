import { ContentVersionView } from "@/modules/content/components/content-version-view"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseContentViewMode } from "@/types/content"

type PromptVersionViewProps = {
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: SynapseLoadedContentVersion<"prompt">
}

function PromptVersionView({ mode, surface, version }: PromptVersionViewProps) {
  return (
    <ContentVersionView
      deletedMessage="该提示词已被删除。"
      mode={mode}
      surface={surface}
      version={version}
    />
  )
}

export { PromptVersionView }
