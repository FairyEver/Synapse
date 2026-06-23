import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { DocumentTemplateNodeConfig } from "./schema"

export function DocumentTemplateNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as DocumentTemplateNodeConfig
  const commit = (patch: Partial<DocumentTemplateNodeConfig>) =>
    onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-template" className="text-xs">模板文件</Label>
            <Input
              id="document-template-node-template"
              value={typedConfig.templatePath}
              onChange={(event) => commit({ templatePath: event.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-output" className="text-xs">输出文件</Label>
            <Input
              id="document-template-node-output"
              value={typedConfig.outputPath}
              onChange={(event) => commit({ outputPath: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="document-template-node-overwrite" className="text-xs font-normal">覆盖已存在文件</Label>
            <Switch
              id="document-template-node-overwrite"
              checked={typedConfig.overwrite}
              onCheckedChange={(checked) => commit({ overwrite: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="数据">
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="document-template-node-data-source" className="text-xs">数据来源</Label>
            <Select
              value={typedConfig.dataSource}
              onValueChange={(value) => commit({ dataSource: value as DocumentTemplateNodeConfig["dataSource"] })}
            >
              <SelectTrigger id="document-template-node-data-source" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dataPath">JSON 文件</SelectItem>
                <SelectItem value="inline">内联 JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {typedConfig.dataSource === "dataPath" ? (
            <div className="grid gap-1">
              <Label htmlFor="document-template-node-data-path" className="text-xs">JSON 文件</Label>
              <Input
                id="document-template-node-data-path"
                value={typedConfig.dataPath ?? ""}
                onChange={(event) => commit({ dataPath: event.target.value })}
              />
            </div>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="document-template-node-data-json" className="text-xs">内联 JSON</Label>
              <Textarea
                id="document-template-node-data-json"
                value={typedConfig.dataJson ?? ""}
                onChange={(event) => commit({ dataJson: event.target.value })}
                className="min-h-32 font-mono text-xs"
              />
            </div>
          )}
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
