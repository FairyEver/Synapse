import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { ScreenshotNodeConfig } from "./schema"

export function ScreenshotNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as ScreenshotNodeConfig
  const commit = (patch: Partial<ScreenshotNodeConfig>) =>
    onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="截图">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="screenshot-node-mode" className="text-xs">模式</Label>
            <Select
              value={typedConfig.mode}
              onValueChange={(value) => commit({ mode: value as ScreenshotNodeConfig["mode"] })}
            >
              <SelectTrigger id="screenshot-node-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fullscreen">全屏</SelectItem>
                <SelectItem value="region">区域</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {typedConfig.mode === "region" ? (
            <div className="grid grid-cols-2 gap-2">
              <CoordinateInput id="screenshot-node-x" label="X" value={typedConfig.x ?? ""} onChange={(x) => commit({ x })} />
              <CoordinateInput id="screenshot-node-y" label="Y" value={typedConfig.y ?? ""} onChange={(y) => commit({ y })} />
              <CoordinateInput id="screenshot-node-width" label="W" value={typedConfig.width ?? ""} onChange={(width) => commit({ width })} />
              <CoordinateInput id="screenshot-node-height" label="H" value={typedConfig.height ?? ""} onChange={(height) => commit({ height })} />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="screenshot-node-hide-window" className="text-xs font-normal">隐藏当前窗口</Label>
            <Switch
              id="screenshot-node-hide-window"
              checked={typedConfig.hideCurrentWindow}
              onCheckedChange={(checked) => commit({ hideCurrentWindow: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="输出">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="screenshot-node-output" className="text-xs">输出文件</Label>
            <Input
              id="screenshot-node-output"
              value={typedConfig.outputPath}
              onChange={(event) => commit({ outputPath: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="screenshot-node-overwrite" className="text-xs font-normal">覆盖已存在文件</Label>
            <Switch
              id="screenshot-node-overwrite"
              checked={typedConfig.overwrite}
              onCheckedChange={(checked) => commit({ overwrite: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="输入映射">
        <VariableBindingEditor
          variables={typedConfig.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>
    </div>
  )
}

function CoordinateInput(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id} className="text-xs">{props.label}</Label>
      <Input id={props.id} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </div>
  )
}
