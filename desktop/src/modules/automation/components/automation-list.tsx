import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
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
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">暂无自动化</p>
        <Button size="sm" variant="outline" disabled={createDisabled} onClick={onCreateNew}>
          <Plus data-icon="inline-start" />
          新建
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
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
    </div>
  )
}

export { AutomationList }
export type { AutomationListProps }
