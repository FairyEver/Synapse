import { useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WorkflowDefinition } from "@/types/workflow"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"

interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  renameSignal?: number
}

export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange, renameSignal }: NodeConfigPanelProps) {
  const node = nodeId ? definition.nodes.find((n) => n.id === nodeId) : null
  const upstreamNodes = useUpstreamNodes(nodeId ?? "", definition)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renameSignal && renameSignal > 0) {
      const timer = setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [renameSignal])

  return (
    <div className="h-full w-full border-l bg-background flex flex-col">
      {node ? (
        <>
          <div className="border-b px-3 py-2 grid gap-1.5">
            <p className="text-xs text-muted-foreground capitalize">{node.type} 节点</p>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">节点名称</Label>
              <Input
                ref={nameInputRef}
                className="h-7 text-xs font-medium"
                defaultValue={node.name}
                key={node.id}
                onBlur={(e) => onNameChange(node.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
              />
            </div>
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
