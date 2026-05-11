import { Input } from "@/components/ui/input"
import type { WorkflowDefinition } from "@/types/workflow"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"

interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
}

export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange }: NodeConfigPanelProps) {
  const node = nodeId ? definition.nodes.find((n) => n.id === nodeId) : null
  const upstreamNodes = useUpstreamNodes(nodeId ?? "", definition)

  return (
    <div className="h-full w-full border-l bg-background flex flex-col">
      {node ? (
        <>
          <div className="border-b px-3 py-2 grid gap-1">
            <Input
              className="h-7 text-xs font-medium"
              defaultValue={node.name}
              key={node.id}
              onBlur={(e) => onNameChange(node.id, e.target.value)}
            />
            <p className="text-xs text-muted-foreground capitalize">{node.type} 节点</p>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {(() => {
              const PanelComponent = getPanel(node.type)
              if (!PanelComponent) return null
              return (
                <PanelComponent
                  key={node.id}
                  config={node.config}
                  onChange={(c) => onConfigChange(node.id, c)}
                  upstreamNodes={upstreamNodes}
                  workflowParams={definition.params}
                />
              )
            })()}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">点击节点编辑配置</p>
        </div>
      )}
    </div>
  )
}
