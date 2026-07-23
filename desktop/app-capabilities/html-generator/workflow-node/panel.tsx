import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import { PromptEditor } from "../../../workflow-nodes/prompt-editor"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import { HTML_GENERATION_TEMPLATE_MAX_BYTES } from "../shared/schema"
import type { HtmlGeneratorEjsFileNodeConfig, HtmlGeneratorNodeConfig } from "./schema"

export function HtmlGeneratorNodePanel({ config, onChange, upstreamNodes, workflowParams }: NodePanelProps) {
  const typedConfig = config as HtmlGeneratorNodeConfig
  const isFile = "outputPath" in typedConfig
  const commit = (patch: Partial<HtmlGeneratorNodeConfig>) => onChange({ ...typedConfig, ...patch })
  const dataBinding = typedConfig.variables.find((binding) => binding.name === "data")
  const pathVariables = isFile ? typedConfig.variables.filter((binding) => binding.name !== "data") : []
  const templateBytes = new TextEncoder().encode(typedConfig.template).byteLength
  const templateError = typedConfig.template.length > 0 && !isWellFormedUnicode(typedConfig.template)
    ? "模板包含无效 Unicode"
    : templateBytes > HTML_GENERATION_TEMPLATE_MAX_BYTES
      ? "模板超过 256 KiB"
      : ""

  const setDataSource = (node: string) => {
    const data = { name: "data" as const, source: { type: "node_output" as const, node } }
    commit({ variables: isFile ? [data, ...pathVariables] : [data] })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="EJS 模板">
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">EJS 模板会执行 JavaScript，仅使用可信内容</p>
          <Textarea
            value={typedConfig.template}
            onChange={(event) => commit({ template: event.target.value })}
            className="min-h-40 resize-y font-mono text-xs"
            spellCheck={false}
            aria-invalid={Boolean(templateError)}
          />
          {templateError ? <p className="text-xs text-destructive">{templateError}</p> : null}
          <p className="text-xs text-muted-foreground">{templateBytes.toLocaleString("en-US")} B / 256 KiB</p>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="数据来源">
        <div className="grid gap-1">
          <Label className="text-xs">上游节点</Label>
          <Select value={dataBinding?.source.type === "node_output" ? dataBinding.source.node : ""} onValueChange={setDataSource}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择数据来源" /></SelectTrigger>
            <SelectContent>
              {upstreamNodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleSection>
      {isFile ? (
        <FileFields
          config={typedConfig}
          pathVariables={pathVariables}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
          onCommit={(patch) => commit(patch)}
        />
      ) : null}
    </div>
  )
}

function FileFields({ config, pathVariables, upstreamNodes, workflowParams, onCommit }: {
  readonly config: HtmlGeneratorEjsFileNodeConfig
  readonly pathVariables: HtmlGeneratorEjsFileNodeConfig["variables"]
  readonly upstreamNodes: NodePanelProps["upstreamNodes"]
  readonly workflowParams: NodePanelProps["workflowParams"]
  readonly onCommit: (patch: Partial<HtmlGeneratorEjsFileNodeConfig>) => void
}) {
  const dataBinding = config.variables.find((binding) => binding.name === "data")
  return (
    <>
      <CollapsibleSection title="输出文件">
        <div className="grid gap-2">
          <PromptEditor
            value={config.outputPath}
            onChange={(outputPath) => onCommit({ outputPath })}
            onBlur={() => onCommit({ outputPath: config.outputPath })}
            variables={pathVariables}
            placeholder="绝对 .html/.htm 路径"
            enableSkillShortcuts={false}
          />
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="html-generator-node-overwrite" className="text-xs font-normal">覆盖已存在文件</Label>
            <Switch
              id="html-generator-node-overwrite"
              checked={config.overwrite}
              onCheckedChange={(checked) => onCommit({ overwrite: checked === true })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="路径变量">
        <VariableBindingEditor
          variables={pathVariables}
          onChange={(variables) => onCommit({ variables: [...(dataBinding ? [dataBinding] : []), ...variables.filter((item) => item.name !== "data")] })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>
    </>
  )
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
