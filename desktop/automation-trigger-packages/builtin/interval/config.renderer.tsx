import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { NumberInput } from "../../../src/components/number-input"
import { ConfigurationFieldError, configurationFieldProps, type ConfigurationFieldErrors } from "../../../src/components/configuration-field-error"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { IntervalTriggerConfig } from "./schema"

export function IntervalTriggerConfigForm({
  value,
  onChange,
  fieldErrors,
}: {
  readonly fieldErrors?: ConfigurationFieldErrors
  readonly value: IntervalTriggerConfig
  readonly onChange: (value: IntervalTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="automation-trigger-interval-minutes">间隔分钟</FieldLabel>
        <FieldContent>
          <NumberInput
            id="automation-trigger-interval-minutes"
            inputMode="numeric"
            value={value.everyMinutes}
            min={1} {...configurationFieldProps(fieldErrors, "everyMinutes", "automation-trigger-interval-minutes")} onValueChange={(everyMinutes) => onChange({ ...value, everyMinutes })}
          />
          <ConfigurationFieldError errors={fieldErrors} name="everyMinutes" id="automation-trigger-interval-minutes" />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel id="automation-interval-anchor-label">起算方式</FieldLabel>
        <FieldContent>
          <ToggleGroup aria-labelledby="automation-interval-anchor-label"
            className="w-full"
            type="single"
            value={value.anchor}
            variant="outline"
            onValueChange={(anchor) => {
              if (anchor === "created_at" || anchor === "last_completed_at") {
                onChange({ ...value, anchor })
              }
            }}
          >
            <ToggleGroupItem className="flex-1" value="created_at">从创建时间</ToggleGroupItem>
            <ToggleGroupItem className="flex-1" value="last_completed_at">上次完成后</ToggleGroupItem>
          </ToggleGroup>
        </FieldContent>
      </Field>
    </div>
  )
}
