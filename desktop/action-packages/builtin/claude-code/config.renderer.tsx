import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { ActionPromptField } from "../../../src/action-runtime/action-prompt-field"
import type { ActionConfigFormComponent } from "../../../src/action-runtime/action-registry"
import type { ClaudeCodeActionConfig } from "./schema"

export const ClaudeCodeConfigForm: ActionConfigFormComponent<ClaudeCodeActionConfig> = ({ value, onChange, projects = [], triggerVariables = [] }) => (
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="task-action-claude-code-project">项目</FieldLabel>
      <FieldContent>
        <Select value={value.projectId} onValueChange={projectId => onChange({ ...value, projectId })}>
          <SelectTrigger id="task-action-claude-code-project" className="w-full">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
    <ActionPromptField id="task-action-claude-code-prompt" value={value.prompt} variables={triggerVariables}
      placeholder="输入提示词" onChange={prompt => onChange({ ...value, prompt })} />
  </FieldGroup>
)
