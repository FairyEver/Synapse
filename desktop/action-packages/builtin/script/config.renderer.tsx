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
import type { ScriptActionConfig } from "./schema"

const SHELL_OPTIONS: Array<{ label: string; value: ScriptActionConfig["shell"] }> = [
  { label: "POSIX", value: "posix" },
  { label: "cmd", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
]

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
        <FieldLabel htmlFor="task-action-script-shell-posix">Shell</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Shell"
            className="w-full"
            data-track="task-action-script-shell"
            type="single"
            value={value.shell}
            variant="outline"
            onValueChange={(shell) => {
              if (shell) onChange({ ...value, shell: shell as ScriptActionConfig["shell"] })
            }}
          >
            {SHELL_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-script-shell-${option.value}`}
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
