import { Button } from "@/components/ui/button"

export type RangePreset = "7d" | "30d" | "90d" | "all"

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "90d", label: "90天" },
  { value: "all", label: "全部" },
]

interface DateRangeFilterProps {
  value: RangePreset
  onChange: (preset: RangePreset) => void
}

export function dateRangeToOptions(preset: RangePreset): { since?: string; until?: string } {
  if (preset === "all") return {}
  const now = new Date()
  const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 89
  const since = new Date(now.getTime() - days * 86_400_000)
  const year = since.getFullYear()
  const month = String(since.getMonth() + 1).padStart(2, "0")
  const day = String(since.getDate()).padStart(2, "0")
  return { since: `${year}-${month}-${day}` }
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex gap-0.5">
      {PRESETS.map((p) => (
        <Button
          key={p.value}
          variant={value === p.value ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  )
}
