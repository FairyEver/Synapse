import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { listDiscoverableBuiltinWorkflowNodeTypes } from "../../../../app-capabilities/surface-discovery"

interface NodePaletteProps {
  collapsed?: boolean
}

export function NodePalette({ collapsed }: NodePaletteProps) {
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
          <div
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-grab hover:bg-muted active:cursor-grabbing"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{manifest.title}</span>
          </div>
        )
      })}
    </div>
  )
}
