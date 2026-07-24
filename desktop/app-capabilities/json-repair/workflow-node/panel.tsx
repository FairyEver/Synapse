import { Field, FieldLabel } from "@/components/ui/field"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { PromptEditor } from "../../../workflow-nodes/prompt-editor"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { JsonRepairNodeConfig } from "./schema"

export function JsonRepairNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as JsonRepairNodeConfig
  const commit = (patch: Partial<JsonRepairNodeConfig>) => onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="修复内容">
        <Field>
          <FieldLabel className="text-xs">输入文本</FieldLabel>
          <PromptEditor
            value={typedConfig.text}
            onChange={(text) => commit({ text })}
            onBlur={() => commit({ text: typedConfig.text })}
            variables={typedConfig.variables}
            placeholder="输入 JSON 文本"
            enableSkillShortcuts={false}
          />
        </Field>
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
