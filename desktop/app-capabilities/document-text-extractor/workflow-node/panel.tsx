import { Field, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { DocumentTextExtractNodeConfig } from "./schema"

export function DocumentTextExtractNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as DocumentTextExtractNodeConfig
  const commit = (patch: Partial<DocumentTextExtractNodeConfig>) => {
    onChange({ ...typedConfig, ...patch })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="document-text-extract-node-file" className="text-xs">
              文档文件
            </FieldLabel>
            <Input
              id="document-text-extract-node-file"
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
