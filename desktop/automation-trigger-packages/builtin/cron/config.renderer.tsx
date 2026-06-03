import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { CronTriggerConfig } from "./schema"

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

export function CronTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: CronTriggerConfig
  readonly onChange: (value: CronTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="automation-trigger-cron-expr">Cron 表达式</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-cron-expr"
            value={value.expr}
            onChange={(event) => onChange({ ...value, expr: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="automation-trigger-cron-timezone">时区</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-cron-timezone"
            value={value.timezone ?? ""}
            onChange={(event) => onChange({ ...value, timezone: event.target.value || undefined })}
          />
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
