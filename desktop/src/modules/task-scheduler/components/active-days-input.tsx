import { cn } from "@/lib/utils"

type ActiveDaysInputProps = {
  value: number[]
  onChange: (days: number[]) => void
  error?: string
}

const DAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: "一" },
  { day: 2, label: "二" },
  { day: 3, label: "三" },
  { day: 4, label: "四" },
  { day: 5, label: "五" },
  { day: 6, label: "六" },
  { day: 0, label: "日" },
]

function ActiveDaysInput({ value, onChange, error }: ActiveDaysInputProps) {
  const selected = new Set(value)

  function toggle(day: number) {
    const next = selected.has(day)
      ? value.filter((d) => d !== day)
      : [...value, day]
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {DAY_LABELS.map(({ day, label }) => (
          <button
            key={day}
            type="button"
            aria-label={`周${label}`}
            aria-pressed={selected.has(day)}
            className={cn(
              "h-8 w-8 rounded-full text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected.has(day)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            onClick={() => toggle(day)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export { ActiveDaysInput }
