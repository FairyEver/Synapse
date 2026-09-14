import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { ReactNode } from "react"
import { ModuleSidebarGroup, type ModuleSidebarGroupProps } from "@/components/module-sidebar"
import { cn } from "@/lib/utils"

const SORTABLE_DRAG_DISTANCE_PX = 6

type ModuleSidebarSortableListProps = {
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly items: readonly string[]
  readonly onReorder: (orderedIds: readonly string[]) => void
}

function ModuleSidebarSortableList({
  children,
  disabled = false,
  items,
  onReorder,
}: ModuleSidebarSortableListProps) {
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: SORTABLE_DRAG_DISTANCE_PX },
  }))

  function handleDragEnd(event: DragEndEvent) {
    if (disabled) return

    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) return

    const activeIndex = items.indexOf(activeId)
    const overIndex = items.indexOf(overId)
    if (activeIndex < 0 || overIndex < 0) return

    onReorder(arrayMove([...items], activeIndex, overIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...items]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

type ModuleSidebarSortableGroupProps = ModuleSidebarGroupProps & {
  readonly sortableDisabled?: boolean
  readonly sortableId: string
}

function ModuleSidebarSortableGroup({
  sortableDisabled = false,
  sortableId,
  ...groupProps
}: ModuleSidebarSortableGroupProps) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: sortableId,
    disabled: sortableDisabled,
  })

  return (
    <div
      ref={setNodeRef}
      data-sortable-id={sortableId}
      data-dragging={isDragging ? "true" : undefined}
      className={cn(
        "w-full min-w-0 max-w-full rounded-lg data-[dragging=true]:bg-muted/60",
        isDragging && "relative z-10",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <ModuleSidebarGroup
        {...groupProps}
        triggerProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export {
  ModuleSidebarSortableGroup,
  ModuleSidebarSortableList,
  type ModuleSidebarSortableGroupProps,
  type ModuleSidebarSortableListProps,
}
