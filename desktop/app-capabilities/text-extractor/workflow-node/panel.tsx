import { Field, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { TextExtractNodeConfig } from "./schema"

export function TextExtractNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as TextExtractNodeConfig
  const commit = (patch: Partial<TextExtractNodeConfig>) => {
    onChange({ ...typedConfig, ...patch })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="text-extract-node-file" className="text-xs">
              文档文件
            </FieldLabel>
            <Input
              id="text-extract-node-file"
              value={typedConfig.filePath}
              onChange={(event) => commit({ filePath: event.target.value })}
            />
          </Field>
        </FieldGroup>
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
