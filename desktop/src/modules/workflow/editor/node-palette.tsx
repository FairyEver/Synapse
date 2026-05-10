import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"

export function NodePalette() {
  const types = nodeTypeRegistry.listTypes()
  return (
    <div className="w-44 border-r bg-background flex flex-col gap-1 p-2">
      <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
      {types.map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-grab hover:bg-muted active:cursor-grabbing"
          >
            <span className="text-muted-foreground">{manifest.title}</span>
          </div>
        )
      })}
    </div>
  )
}
