import { RotateCcw, Trash2 } from "lucide-react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SynapseContentMeta } from "@/types/content"

type ContentBulkActionsProps = {
  batchAction: "restore" | "purge" | null
  busyBatchAction: "restore" | "purge" | null
  deletedFilter: "mine" | "all"
  filteredItemCount: number
  mineLabel?: string
  onBatchActionChange: (action: "restore" | "purge" | null) => void
  onBatchConfirm: () => void
  onDeletedFilterChange: (filter: "mine" | "all") => void
  purgeTarget: SynapseContentMeta | null
  purgeBusy?: boolean
  onPurgeTargetChange: (item: SynapseContentMeta | null) => void
  onPurgeConfirm: () => void
}

function ContentBulkActions({
  batchAction,
  busyBatchAction,
  deletedFilter,
  filteredItemCount,
  mineLabel = "我删除的",
  onBatchActionChange,
  onBatchConfirm,
  onDeletedFilterChange,
  purgeTarget,
  purgeBusy,
  onPurgeTargetChange,
  onPurgeConfirm,
}: ContentBulkActionsProps) {
  const isBatchBusy = busyBatchAction !== null

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Tabs
          data-track="deleted-filter"
          value={deletedFilter}
          onValueChange={(value) => onDeletedFilterChange(value as "mine" | "all")}
        >
          <TabsList className="h-8">
            <TabsTrigger value="mine">{mineLabel}</TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={filteredItemCount === 0 || isBatchBusy}
            onClick={() => onBatchActionChange("restore")}
          >
            <RotateCcw className="mr-1 size-3.5" />
            {busyBatchAction === "restore" ? "恢复中..." : "全部恢复"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={filteredItemCount === 0 || isBatchBusy}
            onClick={() => onBatchActionChange("purge")}
          >
            <Trash2 className="mr-1 size-3.5" />
            {busyBatchAction === "purge" ? "删除中..." : "全部删除"}
          </Button>
        </div>
      </div>

      {/* Single item purge confirmation */}
      <AlertDialog open={purgeTarget !== null} onOpenChange={(open) => { if (!open && !purgeBusy) onPurgeTargetChange(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，内容将被彻底清除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={purgeBusy}
              onClick={onPurgeConfirm}
            >
              {purgeBusy ? "删除中..." : "永久删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch action confirmation */}
      <AlertDialog open={batchAction !== null} onOpenChange={(open) => { if (!open) onBatchActionChange(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchAction === "restore" ? "全部恢复" : "全部永久删除"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {batchAction === "restore"
                ? `将恢复 ${filteredItemCount} 项内容。`
                : `此操作不可撤销，将永久删除 ${filteredItemCount} 项内容。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBatchBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={batchAction === "purge" ? "destructive" : undefined}
              disabled={isBatchBusy}
              onClick={onBatchConfirm}
            >
              {isBatchBusy ? "处理中..." : batchAction === "restore" ? "全部恢复" : "全部永久删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ContentBulkActions }
export type { ContentBulkActionsProps }
