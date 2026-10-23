import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AutomationTimeRange } from "../../automation-trigger-packages/schedule-constraints"

export function TimeRangeField({
  id,
  value,
  onValueChange,
}: {
  readonly id: string
  readonly value?: AutomationTimeRange
  readonly onValueChange: (value: AutomationTimeRange | undefined) => void
}) {
  function update(key: "start" | "end", text: string) {
    const next = { start: value?.start ?? "", end: value?.end ?? "", [key]: text }
    onValueChange(next.start || next.end ? next : undefined)
  }

  return (
    <Field>
      <FieldLabel>时间范围</FieldLabel>
      <FieldContent>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-start`}>开始时间</FieldLabel>
            <Input
              id={`${id}-start`}
              aria-label="开始时间"
              placeholder="HH:mm"
              maxLength={5}
              value={value?.start ?? ""}
              onChange={(event) => update("start", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-end`}>结束时间</FieldLabel>
            <Input
              id={`${id}-end`}
              aria-label="结束时间"
              placeholder="HH:mm"
              maxLength={5}
              value={value?.end ?? ""}
              onChange={(event) => update("end", event.target.value)}
            />
          </Field>
        </div>
        <FieldDescription>留空表示不限制</FieldDescription>
      </FieldContent>
    </Field>
  )
}
