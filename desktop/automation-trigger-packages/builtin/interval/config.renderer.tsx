import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { IntervalTriggerConfig } from "./schema"

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

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
        <FieldLabel>活跃日</FieldLabel>
        <FieldContent>
          <ToggleGroup
            className="w-full"
            type="multiple"
            value={value.activeDays.map(String)}
            variant="outline"
            onValueChange={(days) => {
              const activeDays = days.map(Number).filter((day) => Number.isInteger(day))
              onChange({ ...value, activeDays })
            }}
          >
            {WEEKDAYS.map((day) => (
              <ToggleGroupItem key={day.value} className="flex-1" value={String(day.value)}>
                {day.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
    </div>
  )
}
