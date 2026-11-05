import { useState } from "react"
import { Play, RefreshCw, Zap } from "lucide-react"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { GuidedChoices } from "@/components/guided-flow"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { createPlatformActionDefaultConfig } from "../../../../action-packages/builtin/shell-defaults"
import { listDiscoverableBuiltinAutomationActionTypes } from "../../../../app-capabilities/surface-discovery"
import type { ActionConfig } from "../../../../action-packages/types"
import type { AutomationTriggerConfig } from "@/automation-triggers/action-registry"
import type { SynapseProjectConfig } from "@/types/config"
import type { AutomationEditorStep } from "../types"
import { TriggerVariablesDialog } from "./trigger-variables-dialog"

type TriggerExecutorBuilderProps = {
  step: AutomationEditorStep
  choosing: boolean
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
  try {
    return registry.parseConfig(type, merged)
  } catch {
    return merged
  }
}

function summarize(type: string, config: ActionConfig, trigger: boolean): string {
  try {
    return (trigger ? rendererAutomationTriggerRegistry : rendererActionRegistry).summarize(type, config)
  } catch {
    return "配置尚未完成"
  }
}

export function TriggerExecutorBuilder({ step, choosing, onChoosingChange, triggerType, triggerConfig, executorType, executorConfig,
  projects = [], platform, onTriggerChange, onExecutorChange }: TriggerExecutorBuilderProps) {
  const [pendingChoice, setPendingChoice] = useState<string | null>(null)
  const isTrigger = step === "trigger"
  const type = isTrigger ? triggerType : executorType
  const config = isTrigger ? triggerConfig : executorConfig
  const trigger = rendererAutomationTriggerRegistry.list().find(item => item.manifest.id === triggerType)
  const executor = rendererActionRegistry.list().find(item => item.manifest.id === executorType)
  const selected = isTrigger ? trigger : executor
  const ConfigForm = selected?.ConfigForm
  const title = isTrigger ? "何时触发？" : "执行什么操作？"
  const kind = isTrigger ? "触发条件" : "执行操作"
  const layout = isTrigger ? "trigger" : "executor"
  const discoverable = new Set(listDiscoverableBuiltinAutomationActionTypes(rendererActionRegistry.list().map(item => item.manifest.id)))
  const options = isTrigger ? rendererAutomationTriggerRegistry.list() : rendererActionRegistry.list().filter(item => discoverable.has(item.manifest.id))

  function installChoice(id: string) {
    if (isTrigger) onTriggerChange(id, { ...rendererAutomationTriggerRegistry.getDefaultConfig(id) })
    else onExecutorChange(id, createPlatformActionDefaultConfig(id, rendererActionRegistry.getDefaultConfig(id), platform))
    onChoosingChange(false)
    setPendingChoice(null)
  }

  function choose(id: string) {
    if (type && type !== id) setPendingChoice(id)
    else if (type === id) onChoosingChange(false)
    else installChoice(id)
  }

  return (
    <section data-layout={`automation-editor-${layout}-panel`} className="min-w-0">
      {isTrigger || !trigger ? null : (
        <div className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-4 text-sm">
          <span className="min-w-0 wrap-anywhere text-muted-foreground">触发条件 · {summarize(trigger.manifest.id, triggerConfig, true)}</span>
        </div>
      )}
      {choosing || !selected ? (
        <>
          {type && selected ? <div className="mb-3 flex justify-end"><Button variant="ghost" onClick={() => onChoosingChange(false)}>取消更换</Button></div> : null}
          <GuidedChoices title={title} value={type ?? ""} onSelect={choose}
            options={options.map(item => {
              const Icon = isTrigger ? rendererAutomationTriggerRegistry.get(item.manifest.id).icon ?? Zap : Play
              return { value: item.manifest.id, title: item.manifest.title, icon: <Icon /> }
            })} />
          {type && !selected ? <p role="alert" className="mt-3 text-sm text-destructive">原{kind}不可用，请重新选择</p> : null}
        </>
      ) : (
        <>
          <div data-layout={`automation-editor-${layout}-header`} className="mb-5 flex min-w-0 items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button type="button" variant="ghost" aria-label={`更换${kind}`} onClick={() => onChoosingChange(true)}><RefreshCw />更换</Button>
          </div>
          <div className="grid min-w-0 gap-5">
            <Item data-layout={`automation-editor-${layout}-summary`} variant="muted" size="sm" className="min-w-0">
              <ItemContent className="min-w-0"><ItemTitle>{selected.manifest.title}</ItemTitle>
                <ItemDescription className="wrap-anywhere">{summarize(selected.manifest.id, config, isTrigger)}</ItemDescription>
              </ItemContent>
            </Item>
            {ConfigForm ? <div data-layout={`automation-editor-${layout}-config`} className="min-w-0 [&_[data-slot=field-content]]:min-w-0 [&_[data-slot=field-group]]:min-w-0 [&_[data-slot=field]]:min-w-0 [&_[data-slot=toggle-group]]:max-w-full [&_[data-slot=toggle-group]]:min-w-0">
              <ConfigForm value={parseConfig(selected.manifest.id, config, isTrigger)} projects={projects}
                onChange={value => isTrigger ? onTriggerChange(selected.manifest.id, value) : onExecutorChange(selected.manifest.id, value)} />
            </div> : null}
          </div>
        </>
      )}
      {trigger ? <div className="mt-5"><TriggerVariablesDialog key={trigger.manifest.id} triggerTitle={trigger.manifest.title} variables={trigger.manifest.variables ?? []} /></div> : null}
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
