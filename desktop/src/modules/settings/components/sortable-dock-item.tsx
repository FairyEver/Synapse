import { CSS } from "@dnd-kit/utilities"
import { useSortable } from "@dnd-kit/sortable"
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { REQUIRED_DOCK_APP_ID, type DockMoveDirection } from "@/modules/apps/dock"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type SortableDockItemProps = {
  readonly app: SynapseSystemAppManifest
  readonly disabled: boolean
  readonly isFirst: boolean
  readonly isLast: boolean
  readonly onMove: (appId: SynapseSystemAppId, direction: DockMoveDirection) => void
  readonly onRemove: (appId: SynapseSystemAppId) => void
}

function SortableDockItem({
  app,
  disabled,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: SortableDockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    disabled,
  })
  const removable = app.id !== REQUIRED_DOCK_APP_ID

  return (
    <div
      ref={setNodeRef}
      data-dock-app-id={app.id}
      data-dragging={isDragging ? "true" : undefined}
      className="flex min-h-12 items-center gap-3 px-3 py-2 data-[dragging=true]:bg-muted"
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        aria-label={`拖动 ${app.name}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <img src={app.icon} alt="" className="size-8 shrink-0 object-contain" draggable={false} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || isFirst}
        aria-label={`上移 ${app.name}`}
        onClick={() => onMove(app.id, "up")}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || isLast}
        aria-label={`下移 ${app.name}`}
        onClick={() => onMove(app.id, "down")}
      >
        <ArrowDown />
      </Button>
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onRemove(app.id)}
        >
          <X data-icon="inline-start" />
          移除
        </Button>
      ) : null}
    </div>
  )
}

export { SortableDockItem }
