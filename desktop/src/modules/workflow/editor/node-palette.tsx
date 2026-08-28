import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { listDiscoverableBuiltinWorkflowNodeTypes } from "../../../../app-capabilities/surface-discovery"
import { Button } from "@/components/ui/button"

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
    <div className="h-full border-r bg-background flex flex-col gap-1 p-2">
      <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
      {types.map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        const Icon = manifest.icon
        return (
          <Button
            key={type}
            type="button"
            variant="ghost"
            size="sm"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            onClick={() => onAddNode?.(type)}
            className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{manifest.title}</span>
          </Button>
        )
      })}
    </div>
  )
}
