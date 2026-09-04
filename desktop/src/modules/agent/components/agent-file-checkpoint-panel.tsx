import { useRef, useState } from "react"
import { RotateCcw } from "lucide-react"

import { DiffViewer, type DiffViewMode } from "@/components/diff/diff-viewer"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { SynapseAgentFileCheckpointDiff } from "@/types/agent"
import { useAgentFileCheckpoint } from "../hooks/use-agent-file-checkpoint"

import type { AgentWorkspacePanelRequest } from "./agent-workspace-shell"

export function AgentFileCheckpointPanel({
  projectId,
  conversationId,
  request,
  onRewound,
}: {
  readonly projectId: string
  readonly conversationId: string
  readonly request: AgentWorkspacePanelRequest["payload"]
  readonly onRewound: () => void | Promise<void>
}) {
  const [mode, setMode] = useState<DiffViewMode>("unified")
  const [wrap, setWrap] = useState(true)
  const rewindButtonRef = useRef<HTMLButtonElement>(null)
  const {
    detail,
    selectedFileId,
    setSelectedFileId,
    diff,
    error,
    preparing,
    prepared,
    setPrepared,
    preparedFileCount,
    rewinding,
    prepareRewind,
    confirmRewind,
  } = useAgentFileCheckpoint({ projectId, conversationId, request, onRewound })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          {detail ? `${detail.files.length} 个文件` : "正在加载"}
        </div>
        {detail?.status === "available" ? (
          <Button
            ref={rewindButtonRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={preparing}
            onClick={() => void prepareRewind()}
          >
            <RotateCcw />
            {preparing ? "准备中" : "撤销"}
          </Button>
        ) : null}
      </div>
      {detail ? (
        <div className="shrink-0 border-b py-1">
          {detail.files.map((file) => (
            <Button
              key={file.id}
              type="button"
              variant="ghost"
              className={cn(
                "flex h-8 w-full justify-start rounded-none px-3 font-normal",
                file.id === selectedFileId && "bg-muted",
              )}
              onClick={() => setSelectedFileId(file.id)}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">{file.path}</span>
              <span className="ml-3 shrink-0 text-xs tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>{" "}
                <span className="text-destructive">-{file.deletions}</span>
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="shrink-0 p-3">
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="min-w-0 overflow-x-hidden">
        {diff ? (
          <DiffViewer
            path={diff.path}
            statusLabel={changeKindLabel(diff.kind)}
            text={diff.patch ?? ""}
            binary={diff.binary}
            truncated={diff.truncated}
            truncatedDescription={diff.diffCleared
              ? "差异内容已按空间配额清理，只保留了文件摘要。"
              : "差异内容超过检查点保存上限，只保留了文件摘要。"}
            mode={mode}
            wrap={wrap}
            trackingScope="agent-file-checkpoint"
            dataComponent="agent-file-checkpoint-diff"
            onModeChange={setMode}
            onWrapChange={setWrap}
          />
        ) : !error ? (
          <div className="p-4 text-sm text-muted-foreground">正在加载差异</div>
        ) : null}
      </ScrollArea>
      <AlertDialog open={Boolean(prepared)} onOpenChange={(open) => {
        if (!open && !rewinding) setPrepared(null)
      }}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          rewindButtonRef.current?.focus()
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销这一轮文件修改？</AlertDialogTitle>
            <AlertDialogDescription>
              将恢复 {preparedFileCount} 个文件；对话内容和模型上下文不会回退。
              {prepared?.coverageWarning ? " 终端或子智能体产生的修改可能不在此次撤销范围内。" : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rewinding}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rewinding}
              onClick={(event) => {
                event.preventDefault()
                void confirmRewind()
              }}
            >
              {rewinding ? "正在撤销" : "撤销文件修改"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function changeKindLabel(kind: SynapseAgentFileCheckpointDiff["kind"]): string {
  if (kind === "added") return "新增"
  if (kind === "deleted") return "删除"
  return "修改"
}
