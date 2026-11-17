import type { TodoReminderKind, TodoReminderOffset } from "@synapse/shared/todo-contracts"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

const supportedOptions = [
  { value: "none", label: "不提醒" },
  { value: "before_due:10", label: "提前 10 分钟" },
  { value: "before_due:30", label: "提前 30 分钟" },
  { value: "at_due", label: "截止时提醒" },
] as const

type ReminderChoice = typeof supportedOptions[number]["value"]

function choiceValue(reminder: TodoReminderKind, offsetMinutes: TodoReminderOffset | null): string {
  if (reminder === "before_due") return `before_due:${offsetMinutes ?? "legacy"}`
  return reminder
}

function isSupportedChoice(value: string): value is ReminderChoice {
  return supportedOptions.some((option) => option.value === value)
}

function legacyLabel(reminder: TodoReminderKind, offsetMinutes: TodoReminderOffset | null): string {
  if (reminder === "custom") return "自定义时间（已有）"
  if (offsetMinutes === 60) return "提前 1 小时（已有）"
  if (offsetMinutes === 1440) return "提前 1 天（已有）"
  return "提前提醒（已有）"
}

export function TodoReminderSelect({
  id,
  reminder,
  offsetMinutes,
  disabled,
  onChange,
}: {
  id?: string
  reminder: TodoReminderKind
  offsetMinutes: TodoReminderOffset | null
  disabled: boolean
  onChange: (reminder: TodoReminderKind, offsetMinutes: TodoReminderOffset | null) => void
}) {
  const value = choiceValue(reminder, offsetMinutes)
  const choose = (next: string) => {
    if (next === "none") return onChange("none", null)
    if (next === "before_due:10") return onChange("before_due", 10)
    if (next === "before_due:30") return onChange("before_due", 30)
    if (next === "at_due") return onChange("at_due", null)
  }

  return (
    <NativeSelect
      id={id}
      aria-label="提醒"
      className={id ? "w-full" : undefined}
      data-track="todos.reminder"
      disabled={disabled}
      value={value}
      onChange={(event) => choose(event.target.value)}
    >
      {supportedOptions.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
      ))}
      {!isSupportedChoice(value) && (
        <NativeSelectOption disabled value={value}>
          {legacyLabel(reminder, offsetMinutes)}
        </NativeSelectOption>
      )}
    </NativeSelect>
  )
}
