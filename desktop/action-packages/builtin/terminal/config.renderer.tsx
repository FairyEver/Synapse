import { ConfigurationFieldError, configurationFieldProps } from "../../../src/components/configuration-field-error"
import { Checkbox } from "../../../src/components/ui/checkbox"
import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import type { ActionConfigFormComponent } from "../../../src/action-runtime/action-registry"
import type { TerminalActionConfig } from "./schema"

export const TerminalConfigForm: ActionConfigFormComponent<TerminalActionConfig> = ({ value, onChange, fieldErrors }) => (
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="task-action-terminal-command">命令</FieldLabel>
      <FieldContent>
        <Textarea {...configurationFieldProps(fieldErrors, "command", "task-action-terminal-command")} id="task-action-terminal-command"
          rows={5} value={value.command} onChange={event => onChange({ ...value, command: event.target.value })} />
        <ConfigurationFieldError errors={fieldErrors} name="command" id="task-action-terminal-command" />
      </FieldContent>
    </Field>
    <Field orientation="horizontal">
      <Checkbox {...configurationFieldProps(fieldErrors, "autoClose", "task-action-terminal-auto-close")} id="task-action-terminal-auto-close"
        checked={value.autoClose ?? true} onCheckedChange={checked => onChange({ ...value, autoClose: checked === true })} />
      <FieldContent>
        <FieldLabel htmlFor="task-action-terminal-auto-close">执行完成后自动关闭终端</FieldLabel>
        <ConfigurationFieldError errors={fieldErrors} name="autoClose" id="task-action-terminal-auto-close" />
      </FieldContent>
    </Field>
    <Field>
      <FieldLabel htmlFor="task-action-terminal-timeout">超时分钟</FieldLabel>
      <FieldContent>
        <Input {...configurationFieldProps(fieldErrors, "timeoutMins", "task-action-terminal-timeout")} id="task-action-terminal-timeout"
          type="number" min={1} max={1440} value={value.timeoutMins ?? ""} placeholder="不限制"
          onChange={event => onChange({ ...value, timeoutMins: event.target.value ? Number(event.target.value) : null })} />
        <ConfigurationFieldError errors={fieldErrors} name="timeoutMins" id="task-action-terminal-timeout" />
      </FieldContent>
    </Field>
  </FieldGroup>
)
