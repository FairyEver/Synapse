import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { FileOpenerNodeConfig } from "./schema"

export function FileOpenerNodePanel({ config, onChange, upstreamNodes, workflowParams }: NodePanelProps) {
  const typedConfig = config as FileOpenerNodeConfig
  const commit = (patch: Partial<FileOpenerNodeConfig>) => onChange({ ...typedConfig, ...patch })
  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文件">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="file-opener-node-path" className="text-xs">文件路径</FieldLabel>
            <Input
              id="file-opener-node-path"
              value={typedConfig.path}
              onChange={(event) => commit({ path: event.target.value })}
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

