import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CollapsibleSection } from "../collapsible-section"
import type { NodePanelProps } from "../panel-registry"
import { VariableBindingEditor } from "../variable-binding-editor"
import type { OpenFileNodeConfig } from "./schema"

export function OpenFileNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as OpenFileNodeConfig
  const commit = (patch: Partial<OpenFileNodeConfig>) => {
    onChange({ ...typedConfig, ...patch })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="open-file-node-path" className="text-xs">
              文件路径
            </FieldLabel>
            <Input
              id="open-file-node-path"
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
