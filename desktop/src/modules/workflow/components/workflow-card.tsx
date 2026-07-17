import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { TableCell, TableRow } from "@/components/ui/table"
import type { WorkflowMeta, WorkflowRunStatus } from "@/types/workflow"
import { Download, GitBranch, Play, Trash2, History, Loader2 } from "lucide-react"
import { RUN_STATE_BADGE } from "../lib/status-display"
import { CopyIdButton } from "./copy-id-button"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"

export type WorkflowCardRunState = {
  status: WorkflowRunStatus["status"]
  runId?: string
}

interface WorkflowCardProps { meta: WorkflowMeta; running?: boolean; runState?: WorkflowCardRunState; onOpen: () => void; onRun: () => void; onOpenActiveRun: (runId: string) => void; onHistory: () => void; onExport: () => void; onDelete: () => void }

export function WorkflowCard({ meta, running, runState, onOpen, onRun, onOpenActiveRun, onHistory, onExport, onDelete }: WorkflowCardProps) {
  const badge = runState ? RUN_STATE_BADGE[runState.status] : null
  const hasLoadError = Boolean(meta.loadError)
  const suppressClickRef = useRef(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => { if (!suppressClickRef.current) onOpen() }}
    >
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 max-w-full justify-start px-0 py-0 font-medium hover:bg-transparent"
            title={meta.name}
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
          >
            <span className="truncate">{meta.name}</span>
          </Button>
        </div>
      </TableCell>
      <TableCell>
        {hasLoadError ? <Badge variant="destructive">数据异常</Badge> : badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : <Badge variant="outline">未运行</Badge>}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">{meta.nodeCount} 个节点</TableCell>
      <TableCell>
        <CopyIdButton id={meta.id} kind="workflow" />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {runState?.status === "running" && runState.runId ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="查看进度"
              data-track="workflow-card-open-active-run"
              onClick={(e) => { e.stopPropagation(); onOpenActiveRun(runState.runId!) }}
            >
              <Loader2 className="animate-spin" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={running || hasLoadError}
            aria-label="运行工作流"
            data-track="workflow-card-run"
            onClick={(e) => { e.stopPropagation(); onRun() }}
          >
            {running ? <Loader2 className="animate-spin" /> : <Play />}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="查看运行历史"
            data-track="workflow-card-history"
            onClick={(e) => { e.stopPropagation(); onHistory() }}
          >
            <History />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={hasLoadError && !meta.rawExportAvailable}
            aria-label={meta.rawExportAvailable ? "导出工作流原文" : "导出工作流"}
            data-track="workflow-card-export"
            onClick={(e) => { e.stopPropagation(); onExport() }}
          >
            <Download />
          </Button>
          <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
            suppressClickRef.current = open
            setDeleteDialogOpen(open)
          }}>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={hasLoadError}
              aria-label="删除工作流"
              data-track="workflow-card-delete-open"
              onClick={(e) => {
                e.stopPropagation()
                if (shouldBypassDeleteConfirm(e)) {
                  onDelete()
                  return
                }
                suppressClickRef.current = true
                setDeleteDialogOpen(true)
              }}
            >
              <Trash2 />
            </Button>
            <AlertDialogContent onClick={(event) => event.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>删除工作流</AlertDialogTitle>
                <AlertDialogDescription>确定删除「{meta.name}」？此操作不可恢复。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  )
}
