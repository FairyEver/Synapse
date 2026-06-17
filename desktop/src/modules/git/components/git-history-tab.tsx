import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
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

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function GitHistoryTab({ history }: GitHistoryTabProps) {
  return (
    <div className="grid h-full min-h-0 min-w-0 md:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]">
      <ScrollArea className="min-h-0 min-w-0 border-b md:border-r md:border-b-0">
        <div className="divide-y divide-border">
          {history.loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : history.commits.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">没有提交记录。</div>
          ) : (
            history.commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                data-active={history.selectedCommit?.hash === commit.hash ? "true" : undefined}
                className="grid w-full gap-1 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                onClick={() => void history.loadCommit(commit.hash)}
              >
                <span className="truncate text-sm font-medium">{commit.subject}</span>
                <span className="truncate text-xs text-muted-foreground">{commit.shortHash} · {formatDate(commit.committedAt)}</span>
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
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : history.selectedCommit ? (
            <>
              <div className="space-y-1">
                <div className="truncate text-sm font-medium">{history.selectedCommit.subject}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {history.selectedCommit.shortHash} · {history.selectedCommit.authorName} · {formatDate(history.selectedCommit.committedAt)}
                </div>
              </div>
              {history.selectedCommit.files.length > 0 ? (
                <div className="max-w-full divide-y divide-border overflow-hidden rounded-lg border" data-git-history-file-list="true">
                  {history.selectedCommit.files.map((file) => (
                    <div key={`${file.path}:${file.originalPath ?? ""}`} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{file.path}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{statusLabels[file.status]}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <pre className="block w-full min-w-0 max-w-full overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed text-foreground">
                {history.selectedCommit.diff || "没有文本差异。"}
              </pre>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">选择提交查看详情。</div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
