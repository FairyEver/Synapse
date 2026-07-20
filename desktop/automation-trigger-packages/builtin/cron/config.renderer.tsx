import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { CronInput } from "../../../src/automation-triggers/cron-input"
import { WeekdaySelector } from "../../../src/automation-triggers/weekday-selector"
import type { CronTriggerConfig } from "./schema"

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
          <CronInput
            id="automation-trigger-cron-expr"
            value={value.expr}
            onChange={(expr) => onChange({ ...value, expr })}
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
        <FieldLabel id="automation-trigger-cron-active-days-label">活跃日</FieldLabel>
        <FieldContent>
          <WeekdaySelector
            id="automation-trigger-cron-active-days"
            aria-labelledby="automation-trigger-cron-active-days-label"
            value={value.activeDays}
            onValueChange={(activeDays) => onChange({ ...value, activeDays })}
          />
        </FieldContent>
      </Field>
    </div>
  )
}
