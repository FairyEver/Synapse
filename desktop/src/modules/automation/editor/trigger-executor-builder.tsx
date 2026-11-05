import { useEffect, useId, useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp, Play, Zap } from "lucide-react"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { createPlatformActionDefaultConfig } from "../../../../action-packages/builtin/shell-defaults"
import { listDiscoverableBuiltinAutomationActionTypes } from "../../../../app-capabilities/surface-discovery"
import type { ActionConfig } from "../../../../action-packages/types"
import type { AutomationTriggerConfig } from "@/automation-triggers/action-registry"
import type { SynapseProjectConfig } from "@/types/config"
import type { AutomationEditorStep } from "../types"
import { TriggerVariablesDialog } from "./trigger-variables-dialog"

type TriggerExecutorBuilderProps = {
  step: AutomationEditorStep
  onChoosingChange: (choosing: boolean) => void
  triggerType: string | null
  triggerConfig: AutomationTriggerConfig
  executorType: string | null
  executorConfig: ActionConfig
  projects?: readonly SynapseProjectConfig[]
  platform?: string
  onTriggerChange: (type: string | null, config: AutomationTriggerConfig) => void
  onExecutorChange: (type: string | null, config: ActionConfig) => void
}

function parseConfig(type: string, config: ActionConfig, trigger: boolean): ActionConfig {
  const registry = trigger ? rendererAutomationTriggerRegistry : rendererActionRegistry
  const merged = { ...registry.getDefaultConfig(type), ...config }
  try { return registry.parseConfig(type, merged) } catch { return merged }
}

export function TriggerExecutorBuilder({ step, onChoosingChange, triggerType, triggerConfig, executorType, executorConfig,
  projects = [], platform, onTriggerChange, onExecutorChange }: TriggerExecutorBuilderProps) {
  const [pendingChoice, setPendingChoice] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const headingId = useId()
  const isTrigger = step === "trigger"
  const type = isTrigger ? triggerType : executorType
  const config = isTrigger ? triggerConfig : executorConfig
  const trigger = rendererAutomationTriggerRegistry.list().find(item => item.manifest.id === triggerType)
  const executor = rendererActionRegistry.list().find(item => item.manifest.id === executorType)
  const kind = isTrigger ? "触发条件" : "执行操作"
  const selected = isTrigger ? trigger : executor
  const Icon = selected?.icon ?? (isTrigger ? Zap : Play)
  const discoverable = new Set(listDiscoverableBuiltinAutomationActionTypes(rendererActionRegistry.list().map(item => item.manifest.id)))
  const options = isTrigger ? rendererAutomationTriggerRegistry.list() : rendererActionRegistry.list().filter(item => discoverable.has(item.manifest.id))
  const groups = isTrigger
    ? [
      { title: "按时间", options: options.filter(item => "kind" in item.manifest && item.manifest.kind === "schedule") },
      { title: "按事件", options: options.filter(item => !("kind" in item.manifest) || item.manifest.kind !== "schedule") },
    ]
    : [{ title: "执行操作", options }]
  const ConfigForm = isTrigger ? null : executor?.ConfigForm
  const TriggerForm = isTrigger ? trigger?.ConfigForm : null

  useEffect(() => { onChoosingChange(menuOpen || pendingChoice !== null) }, [menuOpen, pendingChoice, onChoosingChange])

  function installChoice(id: string) {
    if (isTrigger) onTriggerChange(id, { ...rendererAutomationTriggerRegistry.getDefaultConfig(id) })
    else onExecutorChange(id, createPlatformActionDefaultConfig(id, rendererActionRegistry.getDefaultConfig(id), platform))
    setPendingChoice(null)
    setExpanded(true)
  }

  function choose(id: string) {
    setMenuOpen(false)
    if (type && type !== id) setPendingChoice(id)
    else if (type !== id) installChoice(id)
  }

  return (
    <section aria-labelledby={headingId} data-layout={`automation-editor-${step}-panel`} className="min-w-0">
      <h2 id={headingId} className="mb-4 flex items-center gap-3 text-lg font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full border text-xs font-medium">{isTrigger ? 1 : 2}</span>
        {isTrigger ? "当以下情况发生时" : "执行以下操作"}
      </h2>
      <Collapsible open={expanded} onOpenChange={setExpanded} data-track={`automation.editor.${step}.expand`} className="min-w-0 rounded-lg border bg-background">
        {selected ? <div data-layout={`automation-editor-${step}-summary`} className="flex min-w-0 items-center justify-between gap-2 px-4 py-3">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} data-track={`automation.editor.${step}.type`}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" aria-label={`更换${kind}`} className="min-w-0 justify-start">
                <Icon /><span className="truncate">{selected.manifest.title}</span><ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64 max-w-[calc(100vw-2rem)]" align="start">
              <DropdownMenuRadioGroup value={type ?? ""} onValueChange={choose}>
                {groups.filter(group => group.options.length).map(group => <div key={group.title}>
                  <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                  {group.options.map(option => {
                    const OptionIcon = option.icon ?? (isTrigger ? Zap : Play)
                    return <DropdownMenuRadioItem key={option.manifest.id} value={option.manifest.id}>
                      <OptionIcon aria-hidden="true" className="text-muted-foreground" />{option.manifest.title}
                    </DropdownMenuRadioItem>
                  })}
                </div>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`${expanded ? "收起" : "展开"}${isTrigger ? "触发配置" : "执行配置"}`}>
              {expanded ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </CollapsibleTrigger>
        </div> : null}
        {selected ? <CollapsibleContent forceMount hidden={!expanded}>
          <div data-layout={`automation-editor-${step}-config`} className="grid min-w-0 gap-5 border-t p-5 [&_[data-slot=field]]:min-w-0 [&_[data-slot=field-content]]:min-w-0 [&_[data-slot=toggle-group]]:max-w-full">
            {TriggerForm ? <TriggerForm value={parseConfig(trigger!.manifest.id, config, true)} onChange={value => onTriggerChange(trigger!.manifest.id, value)} /> : null}
            {ConfigForm ? <ConfigForm value={parseConfig(executor!.manifest.id, config, false)} projects={projects} triggerVariables={trigger?.manifest.variables ?? []}
              onChange={value => onExecutorChange(executor!.manifest.id, value)} /> : null}
          </div>
        </CollapsibleContent> : <div className="min-w-0 p-3">
          {type ? <p role="alert" className="px-2 py-2 text-sm text-destructive">原{kind}不可用，请重新选择</p> : null}
          {groups.filter(group => group.options.length).map(group => <div key={group.title}>
            <p className="px-2 py-2 text-xs text-muted-foreground">{group.title}</p>
            {group.options.map(option => {
              const OptionIcon = option.icon ?? (isTrigger ? Zap : Play)
              return <Button key={option.manifest.id} type="button" variant="ghost" disabled={!isTrigger && !trigger} onClick={() => choose(option.manifest.id)} className="w-full justify-start">
                <OptionIcon /><span className="min-w-0 flex-1 truncate text-left">{option.manifest.title}</span><ArrowRight className="text-muted-foreground" />
              </Button>
            })}
          </div>)}
          {!isTrigger && !trigger ? <p className="px-2 pt-3 text-xs text-muted-foreground">先选择触发条件</p> : null}
        </div>}
        {isTrigger && trigger ? <div className="border-t bg-muted/30 px-5 py-3"><TriggerVariablesDialog key={trigger.manifest.id} triggerTitle={trigger.manifest.title} variables={trigger.manifest.variables ?? []} /></div> : null}
      </Collapsible>
      <AlertDialog open={pendingChoice !== null} onOpenChange={open => { if (!open) setPendingChoice(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>更换{kind}？</AlertDialogTitle>
            <AlertDialogDescription>{isTrigger ? "当前触发配置将被替换。执行操作保留，请检查使用的触发变量。" : "当前执行配置将被替换。触发条件保持不变。"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (pendingChoice) installChoice(pendingChoice) }}>确认更换</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
