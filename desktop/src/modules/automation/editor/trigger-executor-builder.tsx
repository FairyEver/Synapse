import { type ReactNode } from "react"
import { RefreshCw } from "lucide-react"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { createPlatformActionDefaultConfig } from "../../../../action-packages/builtin/shell-defaults"
import { listDiscoverableBuiltinAutomationActionTypes } from "../../../../app-capabilities/surface-discovery"
import type { ActionConfig } from "../../../../action-packages/types"
import type { AutomationTriggerConfig } from "@/automation-triggers/action-registry"
import type { SynapseProjectConfig } from "@/types/config"
import { TriggerVariablesDialog } from "./trigger-variables-dialog"

type TriggerExecutorBuilderProps = {
  triggerType: string | null
  triggerConfig: AutomationTriggerConfig
  executorType: string | null
  executorConfig: ActionConfig
  projects?: readonly SynapseProjectConfig[]
  platform?: string
  onTriggerChange: (type: string | null, config: AutomationTriggerConfig) => void
  onExecutorChange: (type: string | null, config: ActionConfig) => void
}

function safeTriggerSummary(type: string, config: AutomationTriggerConfig): string {
  try {
    return rendererAutomationTriggerRegistry.summarize(type, config)
  } catch {
    return rendererAutomationTriggerRegistry.get(type).manifest.title
  }
}

function safeExecutorSummary(type: string, config: ActionConfig): string {
  try {
    return rendererActionRegistry.summarize(type, config)
  } catch {
    return rendererActionRegistry.get(type).manifest.title
  }
}

function BuilderHeader({
  actionAriaLabel,
  actionLabel,
  layout,
  onAction,
  title,
}: {
  readonly actionAriaLabel?: string
  readonly actionLabel?: string
  readonly layout: string
  readonly onAction?: () => void
  readonly title: string
}) {
  return (
    <div data-layout={layout} className="mb-5 flex min-w-0 items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {onAction && actionLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 shrink-0"
          aria-label={actionAriaLabel}
          onClick={onAction}
        >
          <RefreshCw />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function SelectedSummary({
  layout,
  title,
  summary,
  extraAction,
}: {
  readonly layout: string
  readonly title: string
  readonly summary: string
  readonly extraAction?: ReactNode
}) {
  return (
    <Item data-layout={layout} variant="muted" size="sm" className="min-w-0 flex-nowrap">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="min-w-0 truncate">{title}</span>
        </ItemTitle>
        <ItemDescription className="truncate">{summary}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        {extraAction}
      </ItemActions>
    </Item>
  )
}

function ChoiceList({
  items,
  onSelect,
}: {
  readonly items: Array<{ readonly id: string; readonly title: string; readonly summary?: string }>
  readonly onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-1">
      {items.map((item) => (
        <button
          data-track="automation.executor.select"
          data-track-native="true"
          key={item.id}
          type="button"
          className="flex w-full items-center justify-between gap-4 rounded-lg bg-transparent px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(item.id)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{item.title}</span>
            {item.summary ? (
              <span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">选择</span>
        </button>
      ))}
    </div>
  )
}

function parseTriggerValue(type: string, config: AutomationTriggerConfig): AutomationTriggerConfig {
  try {
    return rendererAutomationTriggerRegistry.parseConfig(type, config)
  } catch {
    return { ...rendererAutomationTriggerRegistry.getDefaultConfig(type) }
  }
}

function parseExecutorValue(type: string, config: ActionConfig): ActionConfig {
  const mergedConfig = { ...rendererActionRegistry.getDefaultConfig(type), ...config }
  try {
    return rendererActionRegistry.parseConfig(type, mergedConfig)
  } catch {
    return mergedConfig
  }
}

export function TriggerExecutorBuilder({
  triggerType,
  triggerConfig,
  executorType,
  executorConfig,
  projects = [],
  platform,
  onTriggerChange,
  onExecutorChange,
}: TriggerExecutorBuilderProps) {
  const selectedTrigger = triggerType ? rendererAutomationTriggerRegistry.get(triggerType) : null
  const selectedExecutor = executorType ? rendererActionRegistry.get(executorType) : null
  const TriggerConfigForm = selectedTrigger?.ConfigForm
  const ExecutorConfigForm = selectedExecutor?.ConfigForm
  const discoverableExecutorTypes = new Set(
    listDiscoverableBuiltinAutomationActionTypes(
      rendererActionRegistry.list().map((executor) => executor.manifest.id),
    ),
  )

  return (
    <div
      data-layout="automation-editor-builder"
      className="grid h-full min-h-0 w-full max-w-full grid-cols-[400px_1px_minmax(0,1fr)] gap-5 overflow-hidden"
    >
      <section data-layout="automation-editor-trigger-panel" className="min-h-0 min-w-0 overflow-hidden">
        <ScrollArea className="h-full" viewportClassName="overflow-x-hidden">
          <div className="p-5">
            <BuilderHeader
              actionAriaLabel={selectedTrigger ? "更换触发条件" : undefined}
              actionLabel={selectedTrigger ? "更换" : undefined}
              layout="automation-editor-trigger-header"
              onAction={selectedTrigger ? () => onTriggerChange(null, {}) : undefined}
              title="当以下情况发生时"
            />
            {selectedTrigger ? (
              <div className="grid min-w-0 gap-4">
                <SelectedSummary
                  layout="automation-editor-trigger-summary"
                  title={selectedTrigger.manifest.title}
                  summary={safeTriggerSummary(selectedTrigger.manifest.id, triggerConfig)}
                  extraAction={(
                    <TriggerVariablesDialog
                      triggerTitle={selectedTrigger.manifest.title}
                      variables={selectedTrigger.manifest.variables ?? []}
                    />
                  )}
                />
                {TriggerConfigForm ? (
                  <div
                    data-layout="automation-editor-trigger-config"
                    className="min-w-0 [&_[data-slot=field-content]]:min-w-0 [&_[data-slot=field-group]]:min-w-0 [&_[data-slot=field]]:min-w-0 [&_[data-slot=toggle-group]]:max-w-full [&_[data-slot=toggle-group]]:min-w-0"
                  >
                    <TriggerConfigForm
                      value={parseTriggerValue(selectedTrigger.manifest.id, triggerConfig)}
                      onChange={(config) => onTriggerChange(selectedTrigger.manifest.id, config)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <ChoiceList
                items={rendererAutomationTriggerRegistry.list().map((trigger) => ({
                  id: trigger.manifest.id,
                  title: trigger.manifest.title,
                }))}
                onSelect={(id) => onTriggerChange(id, { ...rendererAutomationTriggerRegistry.getDefaultConfig(id) })}
              />
            )}
          </div>
        </ScrollArea>
      </section>

      <Separator data-layout="automation-editor-divider" orientation="vertical" />

      <section data-layout="automation-editor-executor-panel" className="min-h-0 min-w-0 overflow-hidden">
        <ScrollArea className="h-full" viewportClassName="overflow-x-hidden">
          <div className="p-5">
            <BuilderHeader
              actionAriaLabel={selectedExecutor ? "更换执行操作" : undefined}
              actionLabel={selectedExecutor ? "更换" : undefined}
              layout="automation-editor-executor-header"
              onAction={selectedExecutor ? () => onExecutorChange(null, {}) : undefined}
              title="就执行以下操作"
            />
            {selectedExecutor ? (
              <div className="grid min-w-0 gap-4">
                <SelectedSummary
                  layout="automation-editor-executor-summary"
                  title={selectedExecutor.manifest.title}
                  summary={safeExecutorSummary(selectedExecutor.manifest.id, executorConfig)}
                />
                {ExecutorConfigForm ? (
                  <div
                    data-layout="automation-editor-executor-config"
                    className="min-w-0 [&_[data-slot=field-content]]:min-w-0 [&_[data-slot=field-group]]:min-w-0 [&_[data-slot=field]]:min-w-0 [&_[data-slot=toggle-group]]:max-w-full [&_[data-slot=toggle-group]]:min-w-0"
                  >
                    <ExecutorConfigForm
                      value={parseExecutorValue(selectedExecutor.manifest.id, executorConfig)}
                      projects={projects}
                      onChange={(config) => onExecutorChange(selectedExecutor.manifest.id, config)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <ChoiceList
                items={rendererActionRegistry.list()
                  .filter((executor) => discoverableExecutorTypes.has(executor.manifest.id))
                  .map((executor) => ({
                    id: executor.manifest.id,
                    title: executor.manifest.title,
                  }))}
                onSelect={(id) => onExecutorChange(
                  id,
                  createPlatformActionDefaultConfig(id, rendererActionRegistry.getDefaultConfig(id), platform),
                )}
              />
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  )
}
