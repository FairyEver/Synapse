import { Button } from "../../../src/components/ui/button"
import { requestOpenSettingsTab } from "../../../src/app-shell/navigation"
import { ConfigurationFieldError, configurationFieldProps } from "../../../src/components/configuration-field-error"
import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { ActionPromptField } from "../../../src/action-runtime/action-prompt-field"
import { Checkbox } from "../../../src/components/ui/checkbox"
import type { ActionConfigFormComponent } from "../../../src/action-runtime/action-registry"
import type { ClaudeCodeActionConfig } from "./schema"

export const ClaudeCodeConfigForm: ActionConfigFormComponent<ClaudeCodeActionConfig> = ({ value, onChange, projects = [], triggerVariables = [], fieldErrors, onAddProject }) => (
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="task-action-claude-code-project">项目</FieldLabel>
      <FieldContent>
        <Select value={value.projectId} onValueChange={projectId => onChange({ ...value, projectId })}>
          <SelectTrigger {...configurationFieldProps(fieldErrors, "projectId", "task-action-claude-code-project")} id="task-action-claude-code-project" className="w-full">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ConfigurationFieldError errors={fieldErrors} name="projectId" id="task-action-claude-code-project" />
        {!projects.length ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">尚无项目</span><Button type="button" variant="outline" onClick={onAddProject ?? requestOpenSettingsTab}>{onAddProject ? "添加项目" : "打开设置"}</Button></div> : null}
      </FieldContent>
    </Field>
    <ActionPromptField fieldErrors={fieldErrors} id="task-action-claude-code-prompt" value={value.prompt} variables={triggerVariables}
      placeholder="输入提示词" onChange={prompt => onChange({ ...value, prompt })} />
    <Field orientation="horizontal">
      <Checkbox id="task-action-claude-code-single-run" checked={value.singleRun ?? false}
        onCheckedChange={checked => onChange({ ...value, singleRun: checked === true })} />
      <FieldLabel htmlFor="task-action-claude-code-single-run">完成后退出 Claude Code</FieldLabel>
    </Field>
  </FieldGroup>
)
