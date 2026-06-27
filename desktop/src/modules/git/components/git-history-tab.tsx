import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { RelativeTime } from "@/components/relative-time"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { SynapseGitFileChange } from "@/types/git"
import type { useGitHistory } from "../hooks/use-git-history"

type GitHistoryTabProps = {
  readonly history: ReturnType<typeof useGitHistory>
}

const statusLabels: Record<SynapseGitFileChange["status"], string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
  conflicted: "冲突",
  unknown: "未知",
}

export function GitHistoryTab({ history }: GitHistoryTabProps) {
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
            history.commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                data-active={history.selectedCommit?.hash === commit.hash ? "true" : undefined}
                className="grid w-full gap-1.5 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                onClick={() => void history.loadCommit(commit.hash)}
              >
                <span className="truncate text-sm font-medium">{commit.subject}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {commit.shortHash} · {commit.authorName} · <RelativeTime value={commit.committedAt} fallback={commit.committedAt} />
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
      <ScrollArea
        className="min-h-0 min-w-0 max-w-full"
        data-git-history-detail-pane="true"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
      >
        <div className="min-w-0 max-w-full overflow-hidden space-y-3 p-4" data-git-history-detail-content="true">
          {history.error ? (
            <Alert variant="destructive">
              <AlertTitle>读取失败</AlertTitle>
              <AlertDescription>{history.error}</AlertDescription>
            </Alert>
          ) : null}
          {history.detailLoading ? (
            <GitCommitDetailSkeleton />
          ) : history.selectedCommit ? (
            <>
              <div className="grid min-w-0 gap-1">
                <div className="truncate text-base font-semibold">{history.selectedCommit.subject}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {history.selectedCommit.shortHash} · {history.selectedCommit.authorName} · <RelativeTime value={history.selectedCommit.committedAt} fallback={history.selectedCommit.committedAt} />
                </div>
              </div>
              {history.selectedCommit.files.length > 0 ? (
                <div className="max-w-full divide-y divide-border overflow-hidden rounded-lg border" data-git-history-file-list="true">
                  {history.selectedCommit.files.map((file) => (
                    <div key={`${file.path}:${file.originalPath ?? ""}`} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{file.path}</span>
                      <Badge variant="outline">{statusLabels[file.status]}</Badge>
                    </div>
                  ))}
                </div>
              ) : null}
              <pre className="block w-full min-w-0 max-w-full overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed text-foreground">
                {history.selectedCommit.diff || "没有文本差异。"}
              </pre>
            </>
          ) : (
            <Empty className="min-h-64 border bg-muted/20">
              <EmptyHeader>
                <EmptyTitle>选择提交查看详情</EmptyTitle>
              </EmptyHeader>
            </Empty>
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
