import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { ActionConfig } from "../../../../action-packages/types"
import type { AutomationTriggerConfig } from "@/automation-triggers/action-registry"
import type { SynapseProjectConfig } from "@/types/config"

type TriggerExecutorBuilderProps = {
  triggerType: string | null
  triggerConfig: AutomationTriggerConfig
  executorType: string | null
  executorConfig: ActionConfig
  projects?: readonly SynapseProjectConfig[]
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
  title,
  label,
  detail,
}: {
  readonly title: string
  readonly label: string
  readonly detail: string
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
      </div>
      <Badge variant="outline">{detail}</Badge>
    </div>
  )
}

function SelectedHeader({
  title,
  summary,
  onClear,
}: {
  readonly title: string
  readonly summary: string
  readonly onClear: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        重新选择
      </Button>
    </div>
  )
}

function ChoiceList({
  items,
  onSelect,
}: {
  readonly items: Array<{ readonly id: string; readonly title: string; readonly summary: string }>
  readonly onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex min-h-16 w-full items-center justify-between gap-4 rounded-lg bg-transparent px-2 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(item.id)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{item.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span>
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
  onTriggerChange,
  onExecutorChange,
}: TriggerExecutorBuilderProps) {
  const selectedTrigger = triggerType ? rendererAutomationTriggerRegistry.get(triggerType) : null
  const selectedExecutor = executorType ? rendererActionRegistry.get(executorType) : null
  const TriggerConfigForm = selectedTrigger?.ConfigForm
  const ExecutorConfigForm = selectedExecutor?.ConfigForm

  return (
    <div
      data-layout="automation-editor-builder"
      className="grid min-h-full grid-cols-[400px_1px_minmax(0,1fr)] gap-5"
    >
      <section className="min-w-0 py-5">
        <BuilderHeader
          label="触发器"
          title="当以下情况发生时"
          detail={selectedTrigger ? "配置" : "选择"}
        />
        {selectedTrigger ? (
          <div className="grid gap-5">
            <SelectedHeader
              title={selectedTrigger.manifest.title}
              summary={safeTriggerSummary(selectedTrigger.manifest.id, triggerConfig)}
              onClear={() => onTriggerChange(null, {})}
            />
            {TriggerConfigForm ? (
              <TriggerConfigForm
                value={parseTriggerValue(selectedTrigger.manifest.id, triggerConfig)}
                onChange={(config) => onTriggerChange(selectedTrigger.manifest.id, config)}
              />
            ) : null}
          </div>
        ) : (
          <ChoiceList
            items={rendererAutomationTriggerRegistry.list().map((trigger) => ({
              id: trigger.manifest.id,
              title: trigger.manifest.title,
              summary: trigger.summarizeConfig(trigger.manifest.defaultConfig),
            }))}
            onSelect={(id) => onTriggerChange(id, { ...rendererAutomationTriggerRegistry.getDefaultConfig(id) })}
          />
        )}
      </section>

      <Separator data-layout="automation-editor-divider" orientation="vertical" />

      <section className="min-w-0 py-5">
        <BuilderHeader
          label="执行器"
          title="就执行以下操作"
          detail={selectedExecutor ? "配置" : "选择"}
        />
        {selectedExecutor ? (
          <div className="grid gap-5">
            <SelectedHeader
              title={selectedExecutor.manifest.title}
              summary={safeExecutorSummary(selectedExecutor.manifest.id, executorConfig)}
              onClear={() => onExecutorChange(null, {})}
            />
            {ExecutorConfigForm ? (
              <ExecutorConfigForm
                value={parseExecutorValue(selectedExecutor.manifest.id, executorConfig)}
                projects={projects}
                onChange={(config) => onExecutorChange(selectedExecutor.manifest.id, config)}
              />
            ) : null}
          </div>
        ) : (
          <ChoiceList
            items={rendererActionRegistry.list().map((executor) => ({
              id: executor.manifest.id,
              title: executor.manifest.title,
              summary: executor.summarizeConfig(executor.manifest.defaultConfig),
            }))}
            onSelect={(id) => onExecutorChange(id, { ...rendererActionRegistry.getDefaultConfig(id) })}
          />
        )}
      </section>
    </div>
  )
}
