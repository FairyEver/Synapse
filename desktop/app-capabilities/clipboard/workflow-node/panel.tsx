import { CollapsibleSection } from "../../../workflow-nodes/collapsible-section"
import type { NodePanelProps } from "../../../workflow-nodes/panel-registry"
import { PromptEditor } from "../../../workflow-nodes/prompt-editor"
import { VariableBindingEditor } from "../../../workflow-nodes/variable-binding-editor"
import type { ClipboardTextWriteNodeConfig } from "./schema"

export function ClipboardTextWriteNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
}: NodePanelProps) {
  const typedConfig = config as ClipboardTextWriteNodeConfig
  const commit = (patch: Partial<ClipboardTextWriteNodeConfig>) => {
    onChange({ ...typedConfig, ...patch })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="文本">
        <PromptEditor
          value={typedConfig.text}
          onChange={(text) => commit({ text })}
          onBlur={() => commit({ text: typedConfig.text })}
          variables={typedConfig.variables}
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
