import type { AutomationConditions } from "../../schedule-constraints"
import { ConfigurationFieldError, configurationFieldProps, type ConfigurationFieldErrors } from "../../../src/components/configuration-field-error"
import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { CronInput } from "../../../src/automation-triggers/cron-input"
import type { CronTriggerConfig } from "./schema"

export function CronTriggerConfigForm({
  value,
  onChange,
  conditions,
  fieldErrors,
}: {
  readonly conditions?: AutomationConditions
  readonly fieldErrors?: ConfigurationFieldErrors
  readonly value: CronTriggerConfig
  readonly onChange: (value: CronTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel>触发计划</FieldLabel>
        <FieldContent>
          <CronInput
            id="automation-trigger-cron-expr"
            timezone={value.timezone} conditions={conditions} layout="inline"
            value={value.expr}
            onChange={(expr) => onChange({ ...value, expr })}
          />
          <ConfigurationFieldError errors={fieldErrors} name="expr" id="automation-trigger-cron-expr" />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="automation-trigger-cron-timezone">时区</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-cron-timezone" {...configurationFieldProps(fieldErrors, "timezone", "automation-trigger-cron-timezone")} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
            value={value.timezone ?? ""}
            onChange={(event) => onChange({ ...value, timezone: event.target.value || undefined })}
          />
          <ConfigurationFieldError errors={fieldErrors} name="timezone" id="automation-trigger-cron-timezone" />
        </FieldContent>
      </Field>
    </div>
  )
}
