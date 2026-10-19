import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { listDiscoverableBuiltinWorkflowNodeTypes } from "../../../../app-capabilities/surface-discovery"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface NodePaletteProps {
  collapsed?: boolean
  onAddNode?: (type: string) => void
}

export function NodePalette({ collapsed, onAddNode }: NodePaletteProps) {
  const types = listDiscoverableBuiltinWorkflowNodeTypes(
    nodeTypeRegistry.listTypes(),
  ).filter((type) => type !== "end")

  if (collapsed) {
    return <div className="h-full bg-muted" />
  }

  return (
    <ScrollArea className="h-full border-r bg-background" viewportClassName="[&>div]:!block">
      <div className="flex min-w-0 flex-col gap-1 p-2">
        <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
        {types.map((type) => {
          const manifest = nodeTypeRegistry.getManifest(type)
          const Icon = manifest.icon
          return (
            <Button
              key={type}
              type="button"
              variant="ghost"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
              onClick={() => onAddNode?.(type)}
              className="w-full justify-start cursor-grab active:cursor-grabbing"
            >
              <Icon className="text-muted-foreground" />
              <span className="truncate">{manifest.title}</span>
            </Button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
