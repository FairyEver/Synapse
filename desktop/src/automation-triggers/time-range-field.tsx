import { useState } from "react"
import { Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { automationTimeRangeSchema, type AutomationTimeRange } from "../../automation-trigger-packages/schedule-constraints"

const DEFAULT_RANGE: AutomationTimeRange = { start: "08:00", end: "17:00" }
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"))
const END_HOURS = [...HOURS, "24"]
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"))

export function TimeRangeField({
  id,
  value,
  onValueChange,
}: {
  readonly id: string
  readonly value?: AutomationTimeRange
  readonly onValueChange: (value: AutomationTimeRange | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AutomationTimeRange>(DEFAULT_RANGE)
  const valid = automationTimeRangeSchema.safeParse(draft).success
  const errorId = `${id}-error`

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDraft(automationTimeRangeSchema.safeParse(value).success ? { ...value! } : { ...DEFAULT_RANGE })
    setOpen(nextOpen)
  }

  function updateTime(endpoint: "start" | "end", part: "hour" | "minute", text: string) {
    const [hour, minute] = draft[endpoint].split(":")
    const nextHour = part === "hour" ? text : hour
    const nextMinute = nextHour === "24" ? "00" : part === "minute" ? text : minute
    setDraft({ ...draft, [endpoint]: `${nextHour}:${nextMinute}` })
  }

  function confirm() {
    if (!valid) return
    onValueChange({ ...draft })
    setOpen(false)
  }

  function clear() {
    if (value) onValueChange(undefined)
    setOpen(false)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>时间范围</FieldLabel>
      <FieldContent>
        <Popover open={open} onOpenChange={changeOpen} data-track="automation.time-range">
          <PopoverTrigger asChild>
            <Button id={id} type="button" variant="outline" className="w-full justify-start font-normal">
              <Clock3 data-icon="inline-start" />
              {value ? `${value.start} – ${value.end}` : "不限时间"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80" aria-label="选择时间范围">
            <FieldGroup className="grid grid-cols-2 gap-4">
              <TimeChoice
                id={`${id}-start`}
                label="开始"
                value={draft.start}
                onHourChange={(text) => updateTime("start", "hour", text)}
                onMinuteChange={(text) => updateTime("start", "minute", text)}
              />
              <TimeChoice
                id={`${id}-end`}
                label="结束"
                value={draft.end}
                allowEndOfDay
                invalid={!valid}
                errorId={!valid ? errorId : undefined}
                onHourChange={(text) => updateTime("end", "hour", text)}
                onMinuteChange={(text) => updateTime("end", "minute", text)}
              />
            </FieldGroup>
            {!valid ? <FieldError id={errorId}>结束时间必须晚于开始时间</FieldError> : null}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={clear}>不限时间</Button>
              <Button type="button" disabled={!valid} onClick={confirm}>确定</Button>
            </div>
          </PopoverContent>
        </Popover>
      </FieldContent>
    </Field>
  )
}

function TimeChoice({
  id, label, value, allowEndOfDay = false, invalid = false, errorId, onHourChange, onMinuteChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly allowEndOfDay?: boolean
  readonly invalid?: boolean
  readonly errorId?: string
  readonly onHourChange: (value: string) => void
  readonly onMinuteChange: (value: string) => void
}) {
  const [hour, minute] = value.split(":")
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={`${id}-hour`}>{label}时间</FieldLabel>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
        <TimePart
          id={`${id}-hour`}
          label={`${label}小时`}
          value={hour!}
          options={allowEndOfDay ? END_HOURS : HOURS}
          invalid={invalid}
          errorId={errorId}
          onValueChange={onHourChange}
        />
        <span aria-hidden="true">:</span>
        <TimePart
          id={`${id}-minute`}
          label={`${label}分钟`}
          value={minute!}
          options={MINUTES}
          disabled={hour === "24"}
          invalid={invalid}
          errorId={errorId}
          onValueChange={onMinuteChange}
        />
      </div>
    </Field>
  )
}

function TimePart({
  id, label, value, options, disabled, invalid, errorId, onValueChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly errorId?: string
  readonly onValueChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} data-track={`automation.time-range.${label}`}>
      <SelectTrigger id={id} className="w-full" aria-label={label} aria-invalid={invalid || undefined} aria-describedby={errorId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-60 min-w-0" align="start">
        <SelectGroup>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
