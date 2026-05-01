import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { CommandActionConfig } from "./schema"

const SHELL_OPTIONS: Array<{ label: string; value: CommandActionConfig["shell"] }> = [
  { label: "POSIX", value: "posix" },
  { label: "cmd", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
]

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
        <FieldLabel htmlFor="task-action-command-shell-posix">Shell</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Shell"
            className="w-full"
            data-track="task-action-command-shell"
            type="single"
            value={value.shell}
            variant="outline"
            onValueChange={(shell) => {
              if (shell) onChange({ ...value, shell: shell as CommandActionConfig["shell"] })
            }}
          >
            {SHELL_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-command-shell-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
