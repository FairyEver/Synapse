import { Field, FieldLabel } from "@/components/ui/field"
import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { PromptEditor } from "../../../workflow-nodes/prompt-editor"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { SystemNotifierNodeConfig } from "./schema"

export function SystemNotifierNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as SystemNotifierNodeConfig
  const commit = (patch: Partial<SystemNotifierNodeConfig>) => onChange({ ...typedConfig, ...patch })

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="通知内容">
        <div className="grid gap-3">
          <Field>
            <FieldLabel className="text-xs">标题</FieldLabel>
            <PromptEditor
              value={typedConfig.title}
              onChange={(title) => commit({ title })}
              onBlur={() => commit({ title: typedConfig.title })}
              variables={typedConfig.variables}
              placeholder="输入标题"
              enableSkillShortcuts={false}
            />
          </Field>
          <Field>
            <FieldLabel className="text-xs">正文</FieldLabel>
            <PromptEditor
              value={typedConfig.body}
              onChange={(body) => commit({ body })}
              onBlur={() => commit({ body: typedConfig.body })}
              variables={typedConfig.variables}
              placeholder="输入正文"
              enableSkillShortcuts={false}
            />
          </Field>
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
