import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
] as const

type WeekdaySelectorProps = {
  readonly id: string
  readonly value: readonly number[]
  readonly onValueChange: (value: number[]) => void
  readonly disabled?: boolean
  readonly "aria-labelledby"?: string
}

function WeekdaySelector({
  id,
  value,
  onValueChange,
  disabled = false,
  "aria-labelledby": ariaLabelledBy,
}: WeekdaySelectorProps) {
  const selectedDays = new Set(value)

  function updateDay(day: number, checked: boolean) {
    const nextDays = new Set(selectedDays)
    if (checked) {
      nextDays.add(day)
    } else {
      nextDays.delete(day)
    }
    onValueChange(WEEKDAYS.filter((weekday) => nextDays.has(weekday.value)).map((weekday) => weekday.value))
  }

  return (
    <div
      role="group"
      aria-labelledby={ariaLabelledBy}
      data-slot="weekday-selector"
      className="grid w-full grid-cols-4 gap-x-4 gap-y-2"
    >
      {WEEKDAYS.map((weekday) => {
        const checked = selectedDays.has(weekday.value)
        const checkboxId = `${id}-${weekday.value}`

        return (
          <label
            key={weekday.value}
            htmlFor={checkboxId}
            data-state={checked ? "checked" : "unchecked"}
            className={cn(
              "flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-muted/50",
              "focus-within:ring-[3px] focus-within:ring-ring/50",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <Checkbox
              id={checkboxId}
              aria-label={weekday.label}
              checked={checked}
              disabled={disabled}
              className="focus-visible:ring-0"
              onCheckedChange={(nextChecked) => updateDay(weekday.value, nextChecked === true)}
            />
            <span>{weekday.label}</span>
          </label>
        )
      })}
    </div>
  )
}

export { WeekdaySelector }
export type { WeekdaySelectorProps }
