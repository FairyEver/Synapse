import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitFileChange, SynapseGitRepository } from "@/types/git"
import type { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"

type GitChangesTabProps = {
  readonly repository: SynapseGitRepository
  readonly status: ReturnType<typeof useGitWorktreeStatus>
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

export function GitChangesTab({ repository, status }: GitChangesTabProps) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changes = status.snapshot?.changes ?? []
  const commitDisabled = busy || status.selectedPaths.length === 0 || !message.trim()

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      await requireSynapseBridge().git.commit({
        repositoryId: repository.id,
        message: message.trim(),
        paths: [...status.selectedPaths],
      })
      setMessage("")
      await status.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid min-h-0 gap-0 border-b md:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 border-b md:border-r md:border-b-0">
          <div className="divide-y divide-border">
            {status.loading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner />
              </div>
            ) : changes.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">没有改动。</div>
            ) : (
              changes.map((change) => {
                const checked = status.selectedPaths.includes(change.path)
                const active = status.selectedFile?.path === change.path
                return (
                  <div
                    key={`${change.path}:${change.originalPath ?? ""}`}
                    role="button"
                    tabIndex={0}
                    data-active={active ? "true" : undefined}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                    onClick={() => void status.loadDiff(change)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void status.loadDiff(change)
                    }}
                  >
                    <Checkbox
                      aria-label={`选择 ${change.path}`}
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={() => status.togglePath(change.path)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{change.path}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{statusLabels[change.status]}</span>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
        <div className="min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              {status.diffLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner />
                </div>
              ) : status.diff ? (
                <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed text-foreground">
                  {status.diff.binary ? "文件已变更。" : (status.diff.text || "没有文本差异。")}
                </pre>
              ) : (
                <div className="text-sm text-muted-foreground">选择文件查看差异。</div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
      <div className="grid gap-3 p-4">
        {status.error || error ? (
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{status.error ?? error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="git-commit-message">提交说明</Label>
          <Textarea
            id="git-commit-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" disabled={commitDisabled} onClick={() => void commit()}>
            {busy ? "提交中" : "提交选中文件"}
          </Button>
        </div>
      </div>
    </div>
  )
}
