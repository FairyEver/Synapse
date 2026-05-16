import { useEffect, useRef, useState } from "react"
import { Copy, Ellipsis, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowDefinition } from "@/types/workflow"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"

interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  onDeleteNode?: (nodeId: string) => void
  onCopyNode?: (nodeId: string) => void
  renameSignal?: number
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
}

export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange, onDeleteNode, onCopyNode, renameSignal, projects, defaultProjectName }: NodeConfigPanelProps) {
  const node = nodeId ? definition.nodes.find((n) => n.id === nodeId) : null
  const upstreamNodes = useUpstreamNodes(nodeId ?? "", definition)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const nameCancelledRef = useRef(false)

  useEffect(() => {
    if (renameSignal && renameSignal > 0) {
      setIsEditingName(true)
      const timer = setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [renameSignal])

  const manifest = node ? nodeTypeRegistry.getManifest(node.type) : null
  const Icon = manifest?.icon

  const inCount = node ? definition.edges.filter((e) => e.to === node.id).length : 0
  const outCount = node ? definition.edges.filter((e) => e.from === node.id).length : 0

  const connectionSummary = (() => {
    if (!node) return ""
    const inPart = inCount > 0 ? `${inCount} 输入` : ""
    const outLabel = node.type === "switch" ? "分支" : "输出"
    const outPart = outCount > 0 ? `${outCount} ${outLabel}` : ""
    if (inPart && outPart) return `${inPart} → ${outPart}`
    if (inPart) return inPart
    if (outPart) return outPart
    return "未连接"
  })()

  return (
    <div className="h-full w-full border-l bg-background flex flex-col">
      {node ? (
        <>
          <div className="border-b px-3 py-2.5">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                {isEditingName ? (
                  <Input
                    ref={nameInputRef}
                    className="h-6 text-sm font-medium px-1"
                    defaultValue={node.name}
                    key={`${node.id}-edit`}
                    onBlur={(e) => {
                      if (!nameCancelledRef.current) {
                        const trimmed = e.target.value.trim()
                        if (trimmed) onNameChange(node.id, trimmed)
                      }
                      nameCancelledRef.current = false
                      setIsEditingName(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                      if (e.key === "Escape") {
                        nameCancelledRef.current = true
                        e.currentTarget.blur()
                      }
                    }}
                  />
                ) : (
                  <p
                    className="text-sm font-medium truncate cursor-pointer hover:text-foreground/80"
                    onClick={() => setIsEditingName(true)}
                  >
                    {node.name}
                  </p>
                )}
              </div>
              {node.type !== "end" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0">
                      <Ellipsis className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onCopyNode?.(node.id)}>
                      <Copy className="h-3.5 w-3.5" />
                      复制节点
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => onDeleteNode?.(node.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      删除节点
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {manifest?.title ?? node.type} · {connectionSummary}
            </p>
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
                  projects={projects}
                  defaultProjectName={defaultProjectName}
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
