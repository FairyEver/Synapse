import type { ReactNode } from "react"
import { InlineNotice } from "@/components/inline-notice"
import { MarkdownViewer, type MarkdownViewerSurface } from "@/components/markdown-viewer"
import type { SynapseContentViewMode } from "@/types/content"

type ContentVersionViewProps = {
  children?: ReactNode
  deletedMessage: string
  mode: SynapseContentViewMode
  surface?: MarkdownViewerSurface
  version: { content: string; deleted: boolean }
}

function ContentVersionView({ children, deletedMessage, mode, surface, version }: ContentVersionViewProps) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4">
      {version.deleted ? (
        <InlineNotice message={deletedMessage} tone="destructive" />
      ) : null}

      <MarkdownViewer content={version.content} mode={mode} showTabs={false} surface={surface} />

      {children}
    </div>
  )
}

export { ContentVersionView }
