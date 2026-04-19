import { InlineNotice } from "@/components/inline-notice"
import { MarkdownViewer } from "@/components/markdown-viewer"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"
import type { SynapseContentViewMode } from "@/types/content"

type RuleVersionViewProps = {
  mode: SynapseContentViewMode
  version: SynapseLoadedContentVersion<"rule">
}

function RuleVersionView({ mode, version }: RuleVersionViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {version.deleted ? (
        <InlineNotice message="该规则已被删除。" tone="destructive" />
      ) : null}

      <MarkdownViewer content={version.content} mode={mode} showTabs={false} />
    </div>
  )
}

export { RuleVersionView }
