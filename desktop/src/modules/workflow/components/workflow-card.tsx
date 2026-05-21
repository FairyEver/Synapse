import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import type { WorkflowMeta, WorkflowRunStatus } from "@/types/workflow"
import { Download, GitBranch, Play, Trash2, History, Loader2 } from "lucide-react"
import { RUN_STATE_BADGE } from "../lib/status-display"
import { CopyIdButton } from "./copy-id-button"

export type WorkflowCardRunState = WorkflowRunStatus["status"]

interface WorkflowCardProps { meta: WorkflowMeta; running?: boolean; runState?: WorkflowCardRunState; onOpen: () => void; onRun: () => void; onHistory: () => void; onExport: () => void; onDelete: () => void }

export function WorkflowCard({ meta, running, runState, onOpen, onRun, onHistory, onExport, onDelete }: WorkflowCardProps) {
  const badge = runState ? RUN_STATE_BADGE[runState] : null
  const suppressClickRef = useRef(false)

  return (
    <Item
      variant="outline"
      size="sm"
      className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_7rem_4.5rem_auto] items-center gap-3 hover:bg-muted/50"
      tabIndex={0}
      role="button"
      onClick={() => { if (!suppressClickRef.current) onOpen() }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !suppressClickRef.current) { if (e.target !== e.currentTarget) return; e.preventDefault(); onOpen() } }}>
      <ItemMedia variant="icon" className="text-muted-foreground">
        <GitBranch />
      </ItemMedia>
      <ItemContent className="min-w-0 flex-row items-center gap-2">
        <ItemTitle className="w-full min-w-0">
          <span className="min-w-0 truncate">{meta.name}</span>
          {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
        </ItemTitle>
      </ItemContent>
      <span className="justify-self-end whitespace-nowrap text-right text-sm text-muted-foreground">{meta.nodeCount} 个节点</span>
      <CopyIdButton id={meta.id} kind="workflow" className="justify-self-start" />
      <ItemActions className="w-32 justify-end gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={running}
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
          aria-label="导出工作流"
          data-track="workflow-card-export"
          onClick={(e) => { e.stopPropagation(); onExport() }}
        >
          <Download />
        </Button>
        <AlertDialog onOpenChange={(open) => { suppressClickRef.current = open }}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="删除工作流"
              data-track="workflow-card-delete-open"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
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
      </ItemActions>
    </Item>
  )
}
