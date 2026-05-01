import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { Textarea } from "../../../src/components/ui/textarea"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { ScriptActionConfig } from "./schema"

export function ScriptConfigForm({
  value,
  onChange,
}: {
  readonly value: ScriptActionConfig
  readonly onChange: (value: ScriptActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-script-shell">Shell</FieldLabel>
        <FieldContent>
          <Select
            value={value.shell}
            onValueChange={(shell) => onChange({ ...value, shell: shell as ScriptActionConfig["shell"] })}
          >
            <SelectTrigger id="task-action-script-shell" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="posix">POSIX</SelectItem>
                <SelectItem value="cmd">cmd</SelectItem>
                <SelectItem value="powershell">PowerShell</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-script-content">脚本</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-script-content"
            rows={6}
            value={value.script}
            onChange={(event) => onChange({ ...value, script: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-script-env">环境变量</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-script-env"
            rows={3}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-script-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-script-timeout"
            type="number"
            min={1}
            value={value.timeoutMins ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMins: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
