import { useEffect, useRef, useState } from "react"
import { AlertTriangle, ArrowDown, ArrowRight, ChevronDown, Copy, Ellipsis, SlidersHorizontal, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowDefinition, WorkflowLayoutDirection } from "@/types/workflow"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { MODEL_TIER_DISPLAY_LABELS } from "@/lib/provider-model"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { useProviderLookup } from "../../../../workflow-nodes/provider-lookup-context"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"
import { ParamsEditorDialog } from "../components/params-editor-dialog"
import { createRendererLogger } from "@/app-shell/logging"
import { errorDiagnostic } from "../lib/error-utils"
import type { WorkflowValidationDisplayItem } from "./validation-display"

const logger = createRendererLogger("workflow.editor.node-config-panel")

interface NodeConfigPanelProps {
  collapsed?: boolean
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  onDeleteNode?: (nodeId: string) => void
  onCopyNode?: (nodeId: string) => void
  renameSignal?: number
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  onDefinitionChange?: (def: WorkflowDefinition) => void
  onLayoutDirectionChange?: (direction: WorkflowLayoutDirection) => void
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function NodeConfigPanel({ collapsed, nodeId, definition, onConfigChange, onNameChange, onDeleteNode, onCopyNode, renameSignal, projects, defaultProjectName, onDefinitionChange, onLayoutDirectionChange, validationItems = [] }: NodeConfigPanelProps) {
  // Hooks must be called before any early return (React Rules of Hooks).
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

  if (collapsed) {
    return <div className="h-full bg-muted" />
  }

  const node = nodeId ? definition.nodes.find((n) => n.id === nodeId) : null
  const manifest = (() => {
    if (!node) return null
    try {
      return nodeTypeRegistry.getManifest(node.type)
    } catch (err) {
      logger.warn("getManifest failed", {
        nodeId: node.id,
        nodeType: node.type,
        boundary: "renderer.workflow.node-config-panel.getManifest",
        ...errorDiagnostic(err),
      })
      return null
    }
  })()
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
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="节点操作">
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
            <p className="text-xs text-muted-foreground mt-1">
              {manifest?.title ?? node.type} · {connectionSummary}
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              {(() => {
                const PanelComponent = getPanel(node.type)
                if (!PanelComponent) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground"><p>该节点类型暂不支持配置编辑</p></div>
                return (
                  <>
                    {validationItems.length > 0 && (
                      <div className="mb-3 rounded-md border border-destructive/40 bg-background px-3 py-2">
                        <p className="text-xs font-medium text-destructive">当前节点需要处理</p>
                        <div className="mt-1 grid gap-1">
                          {validationItems.map((item) => (
                            <p key={item.id} className="text-xs text-muted-foreground">{item.summary}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    <PanelComponent
                      key={`${node.id}::${definition.version ?? "0"}`}
                      config={node.config}
                      onChange={(c) => onConfigChange(node.id, c)}
                      upstreamNodes={upstreamNodes}
                      workflowParams={definition.params}
                      projects={projects}
                      defaultProjectName={defaultProjectName}
                      defaultProviderId={definition.defaultProviderId}
                      defaultModelTier={definition.defaultModelTier}
                      defaultNodeTimeoutMins={definition.defaultNodeTimeoutMins}
                      validationItems={validationItems}
                      currentWorkflowId={definition.id}
                    />
                  </>
                )
              })()}
            </div>
          </ScrollArea>
        </>
      ) : (
        <GlobalSettingsForm
          definition={definition}
          projects={projects}
          onChange={onDefinitionChange}
          onLayoutDirectionChange={onLayoutDirectionChange}
        />
      )}
    </div>
  )
}

const NO_PROJECT_VALUE = "__none__"
function GlobalSettingsForm({ definition, projects, onChange, onLayoutDirectionChange }: {
  definition: WorkflowDefinition
  projects: readonly SynapseProjectConfig[]
  onChange?: (def: WorkflowDefinition) => void
  onLayoutDirectionChange?: (direction: WorkflowLayoutDirection) => void
}) {
  const [paramsOpen, setParamsOpen] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const { getProviderName, getModelName, getModelDisplayName, isProviderAvailable } = useProviderLookup()
  const providerUnavailable = Boolean(definition.defaultProviderId && !isProviderAvailable(definition.defaultProviderId))

  return (
    <>
      <div className="border-b px-3 py-2.5">
        <p className="text-sm font-medium">工作流设置</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">名称</Label>
          <Input
            className="h-7 text-sm"
            value={definition.name}
            onChange={(e) => onChange?.({ ...definition, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">描述</Label>
          <Textarea
            className="min-h-16 text-xs resize-none"
            value={definition.description ?? ""}
            onChange={(e) => onChange?.({ ...definition, description: e.target.value || undefined })}
            placeholder="添加描述"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">布局方向</Label>
          <ToggleGroup
            type="single"
            value={definition.layoutDirection}
            onValueChange={(value) => {
              if (value !== "horizontal" && value !== "vertical") return
              if (value === definition.layoutDirection) return
              onLayoutDirectionChange?.(value)
            }}
            className="w-full"
          >
            <ToggleGroupItem value="horizontal" className="flex-1" aria-label="左右布局">
              <ArrowRight className="size-3.5" />
              左右
            </ToggleGroupItem>
            <ToggleGroupItem value="vertical" className="flex-1" aria-label="上下布局">
              <ArrowDown className="size-3.5" />
              上下
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">默认供应商</Label>
          <Button variant="outline" className={`w-full justify-between h-7 text-xs${providerUnavailable ? " border-destructive" : ""}`} onClick={() => setProviderDialogOpen(true)}>
            <span className="flex min-w-0 items-center gap-1 truncate">
              {providerUnavailable && <AlertTriangle className="size-3 shrink-0 text-destructive" />}
              {definition.defaultProviderId
                ? `${getProviderName(definition.defaultProviderId) ?? definition.defaultProviderId} · ${getModelDisplayName(definition.defaultProviderId, definition.defaultModelTier ?? "default") ?? getModelName(definition.defaultProviderId, definition.defaultModelTier ?? "default") ?? MODEL_TIER_DISPLAY_LABELS[definition.defaultModelTier ?? "default"]}`
                : "未设置"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
          {providerUnavailable && <p className="text-xs text-destructive">供应商不可用，请重新选择</p>}
          <ProviderModelSelectDialog
            open={providerDialogOpen}
            onOpenChange={setProviderDialogOpen}
            defaultSelection={definition.defaultProviderId ? { providerId: definition.defaultProviderId, modelTier: definition.defaultModelTier ?? "default" } : undefined}
            onSelect={(s) => onChange?.({ ...definition, defaultProviderId: s.providerId, defaultModelTier: s.modelTier })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workflow-default-node-timeout" className="text-xs">默认节点超时(分钟)</Label>
          <Input
            id="workflow-default-node-timeout"
            className="h-7 text-sm"
            type="number"
            min={1}
            value={definition.defaultNodeTimeoutMins ?? 30}
            onChange={(e) => onChange?.({ ...definition, defaultNodeTimeoutMins: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">默认项目</Label>
          <Select
            value={definition.defaultProjectId ?? NO_PROJECT_VALUE}
            onValueChange={(v) => onChange?.({ ...definition, defaultProjectId: v === NO_PROJECT_VALUE ? undefined : v })}
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NO_PROJECT_VALUE}>无默认项目</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div className="space-y-1.5">
          <Label className="text-xs">工作流参数</Label>
          {definition.params.length > 0 ? (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {definition.params.map((p) => (
                <div key={p.name} className="flex items-center gap-1.5">
                  <span className="font-mono">{p.name}</span>
                  <span className="text-muted-foreground/60">({p.type})</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无参数</p>
          )}
          <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => setParamsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
            编辑参数
          </Button>
        </div>
        </div>
      </ScrollArea>
      <ParamsEditorDialog
        open={paramsOpen}
        params={definition.params}
        onChange={(params) => onChange?.({ ...definition, params })}
        onClose={() => setParamsOpen(false)}
      />
    </>
  )
}
