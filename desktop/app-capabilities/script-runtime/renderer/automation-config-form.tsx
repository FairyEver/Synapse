import {
  parseScriptJsonText,
  parseScriptPathText,
  type AutomationScriptInputBinding,
} from "../shared/input"
import type {
  JavascriptAutomationConfig,
  NodejsAutomationConfig,
} from "../shared/schema"
import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { Plus, Trash2 } from "lucide-react"
import { ScriptSourceEditor } from "./script-source-editor"
import { DraftInput } from "./draft-input"
import type { JsonValue } from "../shared/json"

type ScriptAutomationConfig = JavascriptAutomationConfig | NodejsAutomationConfig

export function ScriptAutomationConfigForm<T extends ScriptAutomationConfig>({
  value,
  onChange,
  nodejs = false,
}: {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly nodejs?: boolean
}) {
  const update = (patch: Partial<T>) => onChange({ ...value, ...patch })
  const updateInput = (index: number, binding: AutomationScriptInputBinding) => {
    update({ inputs: value.inputs.map((item, itemIndex) => itemIndex === index ? binding : item) } as Partial<T>)
  }

  return (
    <div className="grid gap-3">
      {nodejs && "moduleMode" in value ? (
        <div className="grid gap-1.5">
          <Label>模块模式</Label>
          <Select
            value={value.moduleMode}
            onValueChange={(moduleMode) => update({ moduleMode } as unknown as Partial<T>)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="commonjs">CommonJS</SelectItem>
              <SelectItem value="esm">ESM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label>脚本</Label>
        <ScriptSourceEditor
          id={nodejs ? "automation-nodejs-source" : "automation-javascript-source"}
          value={value.source}
          onChange={(source) => update({ source } as Partial<T>)}
        />
      </div>
      <div className="grid gap-2">
        <Label>输入</Label>
        {value.inputs.map((binding, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              className="w-32"
              value={binding.name}
              placeholder="名称"
              onChange={(event) => updateInput(index, { ...binding, name: event.target.value })}
            />
            <Select
              value={binding.source.type}
              onValueChange={(type) => updateInput(index, {
                name: binding.name,
                source: type === "trigger"
                  ? { type: "trigger", path: [] }
                  : type === "secret"
                    ? { type: "secret", name: "" }
                    : { type: "static", value: null },
              })}
            >
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="static">固定 JSON</SelectItem>
                <SelectItem value="trigger">触发数据</SelectItem>
                <SelectItem value="secret">密钥</SelectItem>
              </SelectContent>
            </Select>
            {binding.source.type === "secret" ? (
              <Input
                value={binding.source.name}
                placeholder="密钥名称"
                onChange={(event) => updateInput(index, {
                  ...binding,
                  source: { type: "secret", name: event.target.value },
                })}
              />
            ) : (
              <DraftInput
                value={binding.source.type === "trigger" ? binding.source.path : binding.source.value}
                placeholder={binding.source.type === "trigger" ? "路径 JSON" : "值"}
                parse={binding.source.type === "trigger" ? parseScriptPathText : parseScriptJsonText}
                onChange={(parsed) => updateInput(index, {
                  ...binding,
                  source: binding.source.type === "trigger"
                    ? { type: "trigger", path: parsed as Array<string | number> }
                    : { type: "static", value: parsed as JsonValue },
                })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除输入"
              data-track="script-runtime.input.remove"
              onClick={() => update({ inputs: value.inputs.filter((_, itemIndex) => itemIndex !== index) } as Partial<T>)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-track="script-runtime.input.add"
          onClick={() => update({
            inputs: [...value.inputs, { name: "", source: { type: "static", value: null } }],
          } as Partial<T>)}
        >
          <Plus className="size-4" />
          添加输入
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="script-timeout">超时秒数</Label>
        <Input
          id="script-timeout"
          className="w-24"
          type="number"
          min={1}
          max={900}
          value={value.timeoutSeconds}
          onChange={(event) => update({ timeoutSeconds: Number(event.target.value) } as Partial<T>)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="script-save-content">保存运行内容</Label>
        <Switch
          id="script-save-content"
          checked={value.saveRunContent}
          onCheckedChange={(saveRunContent) => update({ saveRunContent } as Partial<T>)}
        />
      </div>
    </div>
  )
}
