import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { WeekdaySelector } from "../../../src/automation-triggers/weekday-selector"
import type { IntervalTriggerConfig } from "./schema"

export function IntervalTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: IntervalTriggerConfig
  readonly onChange: (value: IntervalTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="automation-trigger-interval-minutes">间隔分钟</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-interval-minutes"
            inputMode="numeric"
            value={String(value.everyMinutes)}
            onChange={(event) => onChange({ ...value, everyMinutes: Number(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>起算方式</FieldLabel>
        <FieldContent>
          <ToggleGroup
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
      <Field>
        <FieldLabel id="automation-trigger-interval-active-days-label">活跃日</FieldLabel>
        <FieldContent>
          <WeekdaySelector
            id="automation-trigger-interval-active-days"
            aria-labelledby="automation-trigger-interval-active-days-label"
            value={value.activeDays}
            onValueChange={(activeDays) => onChange({ ...value, activeDays })}
          />
        </FieldContent>
      </Field>
    </div>
  )
}
