import { useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { RelativeTime } from "@/components/relative-time"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { SynapseGitCommitFileChange } from "@/types/git"
import type { useGitHistory } from "../hooks/use-git-history"
import { mapCommitDiffSections } from "../lib/git-diff-sections"
import { GitDiffViewer, GitRawDiff, type GitDiffViewMode } from "./git-diff-viewer-adapter"

type GitHistoryTabProps = {
  readonly history: ReturnType<typeof useGitHistory>
  readonly diffViewMode: GitDiffViewMode
  readonly diffWrap: boolean
  readonly onDiffViewModeChange: (mode: GitDiffViewMode) => void
  readonly onDiffWrapChange: (wrap: boolean) => void
}

const statusLabels: Record<SynapseGitCommitFileChange["status"], string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  unknown: "未知",
}

export function GitHistoryTab({
  history,
  diffViewMode,
  diffWrap,
  onDiffViewModeChange,
  onDiffWrapChange,
}: GitHistoryTabProps) {
  const selectedCommit = history.selectedCommit
  const [selectedFile, setSelectedFile] = useState<{ readonly commitHash: string; readonly index: number } | null>(null)
  const selectedFileIndex = selectedFile && selectedFile.commitHash === selectedCommit?.hash ? selectedFile.index : 0
  const diffSections = useMemo(() => (
    selectedCommit ? mapCommitDiffSections(selectedCommit.diff, selectedCommit.files) : null
  ), [selectedCommit])
  const canUseFormattedDiff = Boolean(
    selectedCommit
    && !selectedCommit.filesTruncated
    && !selectedCommit.diffTruncated
    && diffSections,
  )
  const selectedSection = canUseFormattedDiff ? diffSections?.[selectedFileIndex] : undefined

  return (
    <div className="grid h-full min-h-0 min-w-0 bg-background md:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
      <ScrollArea className="min-h-0 min-w-0 border-b md:border-r md:border-b-0">
        <div className="min-h-full divide-y divide-border">
          {history.loading ? (
            <GitCommitListSkeleton />
          ) : history.commits.length === 0 ? (
            <Empty className="min-h-40 rounded-none border-0 bg-transparent">
              <EmptyHeader>
                <EmptyTitle>暂无提交</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {history.commits.map((commit) => (
                <button
                  data-track="git.history.commit.select"
                  data-track-native="true"
                  key={commit.hash}
                  type="button"
                  data-active={history.selectedCommit?.hash === commit.hash ? "true" : undefined}
                  className="grid w-full gap-1.5 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                  onClick={() => void history.loadCommit(commit.hash)}
                >
                  <span className="truncate text-sm font-medium">{commit.subject || "无提交说明"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {commit.shortHash} · {commit.authorName} · <RelativeTime value={commit.committedAt} fallback={commit.committedAt} />
                  </span>
                </button>
              ))}
              {history.hasMore ? (
                <div className="flex justify-center p-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={history.loadingMore}
                    onClick={() => void history.loadMore()}
                  >
                    {history.loadingMore ? "加载中" : "加载更多"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
      <ScrollArea
        className="min-h-0 min-w-0 max-w-full"
        data-git-history-detail-pane="true"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
      >
        <div className="min-w-0 max-w-full overflow-hidden" data-git-history-detail-content="true">
          {history.error ? (
            <div className="p-4 pb-0">
              <Alert variant="destructive">
                <AlertTitle>读取失败</AlertTitle>
                <AlertDescription>{history.error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {history.detailLoading ? (
            <div className="p-4"><GitCommitDetailSkeleton /></div>
          ) : selectedCommit ? (
            <div className="grid min-w-0">
              <div className="grid min-w-0 gap-3 border-b p-4">
                <div className="grid min-w-0 gap-1">
                  <div className="truncate text-base font-semibold">{selectedCommit.subject || "无提交说明"}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {selectedCommit.shortHash} · {selectedCommit.authorName} · <RelativeTime value={selectedCommit.committedAt} fallback={selectedCommit.committedAt} />
                  </div>
                </div>
                {selectedCommit.files.length > 0 ? (
                  <div className="max-h-80 max-w-full divide-y divide-border overflow-x-hidden overflow-y-auto rounded-lg border" data-git-history-file-list="true">
                    {selectedCommit.files.map((file, index) => {
                      const content = (
                        <>
                          <span className="min-w-0 truncate font-medium">{file.path}</span>
                          <Badge variant="outline">{statusLabels[file.status]}</Badge>
                        </>
                      )
                      return canUseFormattedDiff ? (
                        <button
                          data-track="git.history.file.select"
                          data-track-native="true"
                          key={`${file.path}:${file.originalPath ?? ""}`}
                          type="button"
                          data-active={selectedFileIndex === index ? "true" : undefined}
                          className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                          onClick={() => setSelectedFile({ commitHash: selectedCommit.hash, index })}
                        >
                          {content}
                        </button>
                      ) : (
                        <div key={`${file.path}:${file.originalPath ?? ""}`} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm">
                          {content}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
                {selectedCommit.filesTruncated ? (
                  <Alert>
                    <AlertTitle>文件列表已截断</AlertTitle>
                    <AlertDescription>文件数量过多，仅显示前 2 MiB。</AlertDescription>
                  </Alert>
                ) : null}
                {selectedCommit.diffTruncated ? (
                  <Alert>
                    <AlertTitle>差异内容已截断</AlertTitle>
                    <AlertDescription>差异过大，仅显示前 2 MiB。</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              {selectedSection ? (
                <GitDiffViewer
                  path={selectedSection.path}
                  originalPath={selectedSection.originalPath}
                  statusLabel={statusLabels[selectedSection.status]}
                  text={selectedSection.text}
                  mode={diffViewMode}
                  wrap={diffWrap}
                  onModeChange={onDiffViewModeChange}
                  onWrapChange={onDiffWrapChange}
                />
              ) : (
                <GitRawDiff
                  text={selectedCommit.diff}
                  parseFailed={Boolean(
                    selectedCommit.diff
                    && !selectedCommit.filesTruncated
                    && !selectedCommit.diffTruncated
                    && diffSections === null
                  )}
                />
              )}
            </div>
          ) : (
            <div className="p-4">
              <Empty className="min-h-64 border bg-muted/20">
                <EmptyHeader>
                  <EmptyTitle>选择提交查看详情</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function GitCommitListSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-4 w-full max-w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  )
}

function GitCommitDetailSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
