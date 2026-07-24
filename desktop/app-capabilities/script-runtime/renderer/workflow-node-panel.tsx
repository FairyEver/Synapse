import type { WorkflowParam } from "../../../src/types/workflow"
import type {
  JavascriptWorkflowConfig,
  NodejsWorkflowConfig,
} from "../shared/schema"
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { ScriptSourceEditor } from "./script-source-editor"
import { WorkflowScriptInputEditor } from "./workflow-input-editor"

type WorkflowScriptConfig = JavascriptWorkflowConfig | NodejsWorkflowConfig

export function ScriptWorkflowNodePanel<T extends WorkflowScriptConfig>({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
  nodejs = false,
}: {
  readonly config: T
  readonly onChange: (config: T) => void
  readonly upstreamNodes: readonly { id: string; name: string }[]
  readonly workflowParams: readonly WorkflowParam[]
  readonly nodejs?: boolean
}) {
  const update = (patch: Partial<T>) => onChange({ ...config, ...patch })

  return (
    <div className="grid gap-3">
      {nodejs && "moduleMode" in config ? (
        <>
          <div className="grid gap-1.5">
            <Label>模块模式</Label>
            <Select
              value={config.moduleMode}
              onValueChange={(moduleMode) => update({ moduleMode } as unknown as Partial<T>)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="commonjs">CommonJS</SelectItem>
                <SelectItem value="esm">ESM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>工作目录</Label>
            <Input
              value={config.workingDirectory ?? ""}
              onChange={(event) => update({ workingDirectory: event.target.value || undefined } as unknown as Partial<T>)}
            />
          </div>
        </>
      ) : null}
      <div className="grid gap-1.5">
        <Label>脚本</Label>
        <ScriptSourceEditor
          value={config.source}
          onChange={(source) => update({ source } as Partial<T>)}
        />
      </div>
      <WorkflowScriptInputEditor
        value={config.inputs}
        onChange={(inputs) => update({ inputs } as Partial<T>)}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="flex items-center gap-2">
        <Label htmlFor="workflow-script-timeout">超时秒数</Label>
        <Input
          id="workflow-script-timeout"
          className="w-24"
          type="number"
          min={1}
          max={900}
          value={config.timeoutSeconds}
          onChange={(event) => update({ timeoutSeconds: Number(event.target.value) } as Partial<T>)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="workflow-script-save-content">保存运行内容</Label>
        <Switch
          id="workflow-script-save-content"
          checked={config.saveRunContent}
          onCheckedChange={(saveRunContent) => update({ saveRunContent } as Partial<T>)}
        />
      </div>
    </div>
  )
}
