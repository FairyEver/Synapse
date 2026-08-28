import { DndContext, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
import type { SynapseSystemAppId } from "@/modules/apps/types"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SortableDockItem } from "@/modules/settings/components/sortable-dock-item"

type DockPanelProps = {
  readonly workflowEntryVisible: boolean
}

function DockPanel({ workflowEntryVisible }: DockPanelProps) {
  const dock = useDockPreferences({ workflowEntryVisible })

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id) as SynapseSystemAppId
    const overId = event.over ? String(event.over.id) as SynapseSystemAppId : null
    if (!overId || activeId === overId) {
      return
    }

    void dock.reorderDockApps(activeId, overId)
  }

  return (
    <div className="flex flex-col gap-2">
      <SettingsGroup sectionClassName="p-0">
        <div>
          <div className="px-4 py-3">
            <h2 className="text-sm font-medium">已固定</h2>
          </div>
          <Separator />
          <DndContext onDragEnd={handleDragEnd}>
            <SortableContext items={dock.pinnedApps.map((app) => app.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border">
                {dock.pinnedApps.map((app, index) => (
                  <SortableDockItem
                    key={app.id}
                    app={app}
                    disabled={dock.saving}
                    isFirst={index === 0}
                    isLast={index === dock.pinnedApps.length - 1}
                    onMove={dock.moveDockApp}
                    onRemove={(appId) => void dock.removeDockApp(appId)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </SettingsGroup>

      <SettingsGroup sectionClassName="p-0">
        <div>
          <div className="px-4 py-3">
            <h2 className="text-sm font-medium">可添加</h2>
          </div>
          <Separator />
          {dock.addableApps.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">已全部固定</div>
          ) : (
            <div className="divide-y divide-border">
              {dock.addableApps.map((app) => (
                <div key={app.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                  <img src={app.icon} alt="" className="size-8 shrink-0 object-contain" draggable={false} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={dock.saving}
                    onClick={() => void dock.addDockApp(app.id)}
                  >
                    <Plus data-icon="inline-start" />
                    添加
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={dock.saving}
          onClick={() => void dock.restoreDefaultDock()}
        >
          <RotateCcw data-icon="inline-start" />
          恢复默认
        </Button>
      </div>
    </div>
  )
}

export { DockPanel }
