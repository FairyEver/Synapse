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
import type { CommandActionConfig } from "./schema"

export function CommandConfigForm({
  value,
  onChange,
}: {
  readonly value: CommandActionConfig
  readonly onChange: (value: CommandActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-command-shell">Shell</FieldLabel>
        <FieldContent>
          <Select
            value={value.shell}
            onValueChange={(shell) => onChange({ ...value, shell: shell as CommandActionConfig["shell"] })}
          >
            <SelectTrigger id="task-action-command-shell" className="w-full">
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
        <FieldLabel htmlFor="task-action-command-content">命令</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-content"
            value={value.command}
            onChange={(event) => onChange({ ...value, command: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-env">环境变量</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-command-env"
            rows={3}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-timeout"
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
