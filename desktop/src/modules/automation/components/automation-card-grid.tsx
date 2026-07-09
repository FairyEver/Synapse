import { Workflow, Plus } from "lucide-react"
import type { MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { SynapseProjectConfig } from "@/types/config"
import type { AutomationItem } from "@/types/automation"
import { AutomationCard } from "./automation-card"

type AutomationCardGridProps = {
  items: AutomationItem[]
  projects: readonly SynapseProjectConfig[]
  createDisabled: boolean
  pendingItemIds: ReadonlySet<string>
  runningItemIds: ReadonlySet<string>
  onRun: (item: AutomationItem) => void
  onStop: (item: AutomationItem) => void
  onToggleEnabled: (item: AutomationItem, enabled: boolean) => void
  onEdit: (item: AutomationItem) => void
  onHistory: (item: AutomationItem) => void
  onDelete: (item: AutomationItem, event: MouseEvent<HTMLElement>) => void
  onCreateNew: () => void
}

function AutomationCardGrid({
  items,
  projects,
  createDisabled,
  pendingItemIds,
  runningItemIds,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
  onCreateNew,
}: AutomationCardGridProps) {
  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Workflow />
          </EmptyMedia>
          <EmptyTitle>暂无自动化</EmptyTitle>
          <EmptyDescription>新建后会按触发器执行。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" disabled={createDisabled} onClick={onCreateNew}>
            <Plus />
            新建自动化
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
      {items.map((item) => (
        <AutomationCard
          key={item.id}
          item={item}
          projects={projects}
          pending={pendingItemIds.has(item.id)}
          running={runningItemIds.has(item.id)}
          onRun={() => onRun(item)}
          onStop={() => onStop(item)}
          onToggleEnabled={(enabled) => onToggleEnabled(item, enabled)}
          onEdit={() => onEdit(item)}
          onHistory={() => onHistory(item)}
          onDelete={(event) => onDelete(item, event)}
        />
      ))}
    </div>
  )
}

export { AutomationCardGrid }
export type { AutomationCardGridProps }
