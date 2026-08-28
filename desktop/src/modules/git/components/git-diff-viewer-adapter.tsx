import {
  DiffViewer,
  RawDiff,
  type DiffViewerProps,
  type DiffViewMode,
} from "@/components/diff/diff-viewer"

export type GitDiffViewMode = DiffViewMode

export function GitDiffViewer(props: DiffViewerProps) {
  return (
    <DiffViewer
      {...props}
      dataComponent="git-diff-view"
      trackingScope="git"
      truncatedDescription="内容过大，仅显示前 2 MiB。"
    />
  )
}

export const GitRawDiff = RawDiff
