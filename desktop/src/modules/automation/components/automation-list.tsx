import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AutomationItem } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import { AutomationListRow } from "./automation-list-row"

type AutomationListProps = {
  readonly items: AutomationItem[]
  readonly projects: readonly SynapseProjectConfig[]
  readonly createDisabled: boolean
  readonly pendingItemIds: ReadonlySet<string>
  readonly runningItemIds: ReadonlySet<string>
  readonly onOpen: (item: AutomationItem) => void
  readonly onRun: (item: AutomationItem) => void
  readonly onStop: (item: AutomationItem) => void
  readonly onToggleEnabled: (item: AutomationItem, enabled: boolean) => void
  readonly onHistory: (item: AutomationItem) => void
  readonly onDelete: (item: AutomationItem) => void
  readonly onCreateNew: () => void
}

function AutomationList({
  items,
  projects,
  createDisabled,
  pendingItemIds,
  runningItemIds,
  onOpen,
  onRun,
  onStop,
  onToggleEnabled,
  onHistory,
  onDelete,
  onCreateNew,
}: AutomationListProps) {
  if (items.length === 0) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>暂无自动化</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" disabled={createDisabled} onClick={onCreateNew}>
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table className="table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="w-24" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-16" />
          <col className="w-36" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>自动化</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">下次运行</TableHead>
            <TableHead className="text-right">范围</TableHead>
            <TableHead className="text-right">启用</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <AutomationListRow
              key={item.id}
              item={item}
              projects={projects}
              pending={pendingItemIds.has(item.id)}
              running={runningItemIds.has(item.id)}
              onOpen={() => onOpen(item)}
              onRun={() => onRun(item)}
              onStop={() => onStop(item)}
              onToggleEnabled={(enabled) => onToggleEnabled(item, enabled)}
              onHistory={() => onHistory(item)}
              onDelete={() => onDelete(item)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { AutomationList }
export type { AutomationListProps }
