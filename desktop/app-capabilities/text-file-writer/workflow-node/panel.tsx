import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import { PromptEditor } from "../../../workflow-nodes/prompt-editor"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import { TEXT_FILE_ENCODINGS, type TextFileEncoding } from "../shared/schema"
import type { TextFileWriterNodeConfig } from "./schema"

export function TextFileWriterNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as TextFileWriterNodeConfig
  const commit = (patch: Partial<TextFileWriterNodeConfig>) => onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="text-file-writer-node-path" className="text-xs">文件路径</Label>
            <Input
              id="text-file-writer-node-path"
              value={typedConfig.path}
              onChange={(event) => commit({ path: event.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="text-file-writer-node-encoding" className="text-xs">字符编码</Label>
            <Select
              value={typedConfig.encoding}
              onValueChange={(value) => commit({ encoding: value as TextFileWriterNodeConfig["encoding"] })}
            >
              <SelectTrigger id="text-file-writer-node-encoding" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_FILE_ENCODINGS.map((value) => (
                  <SelectItem key={value} value={value}>{encodingLabel(value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="text-file-writer-node-overwrite" className="text-xs font-normal">覆盖已存在文件</Label>
            <Switch
              id="text-file-writer-node-overwrite"
              checked={typedConfig.overwrite}
              onCheckedChange={(checked) => commit({ overwrite: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="文本内容" summary={typedConfig.text.length > 0 ? `${typedConfig.text.length}字` : undefined}>
        <PromptEditor
          value={typedConfig.text}
          onChange={(text) => commit({ text })}
          onBlur={() => commit({ text: typedConfig.text })}
          variables={typedConfig.variables}
          placeholder="输入文本，用 {{变量名}} 引用变量…"
          enableSkillShortcuts={false}
        />
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

function encodingLabel(encoding: TextFileEncoding): string {
  return encoding === "utf8" ? "UTF-8" : "UTF-16 LE"
}
