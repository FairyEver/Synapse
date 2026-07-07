import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import type { SwarmTaskNodeConfig } from "./schema"

const DEFAULT_RUN_MODE_VALUE = "__default"

export function SwarmTaskNodePanel({ config, onChange }: NodePanelProps) {
  const typedConfig = config as SwarmTaskNodeConfig
  const commit = (patch: Partial<SwarmTaskNodeConfig>) =>
    onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="任务">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="swarm-task-node-task-id" className="text-xs">任务 ID</Label>
            <Input
              id="swarm-task-node-task-id"
              value={typedConfig.taskId}
              onChange={(event) => commit({ taskId: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="swarm-task-node-wait" className="text-xs font-normal">等待完成</Label>
            <Switch
              id="swarm-task-node-wait"
              checked={typedConfig.waitForCompletion}
              onCheckedChange={(checked) => commit({ waitForCompletion: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="覆盖">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="swarm-task-node-prompt" className="text-xs">提示词</Label>
            <Textarea
              id="swarm-task-node-prompt"
              value={typedConfig.promptOverride ?? ""}
              onChange={(event) => commit({ promptOverride: emptyToUndefined(event.target.value) })}
              className="min-h-24 text-xs"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="swarm-task-node-run-mode" className="text-xs">运行模式</Label>
            <Select
              value={typedConfig.runModeOverride ?? DEFAULT_RUN_MODE_VALUE}
              onValueChange={(value) => commit({
                runModeOverride: value === DEFAULT_RUN_MODE_VALUE
                  ? undefined
                  : value as SwarmTaskNodeConfig["runModeOverride"],
              })}
            >
              <SelectTrigger id="swarm-task-node-run-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_RUN_MODE_VALUE}>默认</SelectItem>
                <SelectItem value="batch">批量</SelectItem>
                <SelectItem value="continuous">持续</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberOverrideInput
              id="swarm-task-node-max-rounds"
              label="最大轮次"
              value={typedConfig.maxRoundsOverride}
              onChange={(maxRoundsOverride) => commit({ maxRoundsOverride })}
            />
            <NumberOverrideInput
              id="swarm-task-node-concurrency"
              label="并发数"
              value={typedConfig.concurrencyOverride}
              onChange={(concurrencyOverride) => commit({ concurrencyOverride })}
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  )
}

function NumberOverrideInput(props: {
  readonly id: string
  readonly label: string
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id} className="text-xs">{props.label}</Label>
      <Input
        id={props.id}
        type="number"
        value={props.value ?? ""}
        onChange={(event) => props.onChange(parseOptionalNumber(event.target.value))}
      />
    </div>
  )
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() ? value : undefined
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
