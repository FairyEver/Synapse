import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTokens } from "../lib/format"

interface ContributionDay {
  date: string
  tokens: number
  intensity: 0 | 1 | 2 | 3 | 4
}

interface ContributionGraphProps {
  contributions: ContributionDay[]
  selectedDate?: string | null
  onDateClick?: (date: string | null) => void
}

const INTENSITY_CLASSES = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
]

export function ContributionGraph({ contributions, selectedDate, onDateClick }: ContributionGraphProps) {
  const today = new Date()
  const grid: (ContributionDay | null)[][] = []
  const contribMap = new Map(contributions.map((c) => [c.date, c]))

  const start = new Date(today)
  start.setDate(start.getDate() - 52 * 7 - start.getDay())

  for (let week = 0; week < 53; week++) {
    const col: (ContributionDay | null)[] = []
    for (let day = 0; day < 7; day++) {
      const d = new Date(start)
      d.setDate(d.getDate() + week * 7 + day)
      if (d > today) {
        col.push(null)
        continue
      }
      const dateStr = d.toISOString().slice(0, 10)
      col.push(contribMap.get(dateStr) || { date: dateStr, tokens: 0, intensity: 0 })
    }
    grid.push(col)
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex gap-0.5 overflow-x-auto">
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="h-2.5 w-2.5" />
              const isSelected = selectedDate === day.date
              return (
                <Tooltip key={di}>
                  <TooltipTrigger asChild>
                    <div
                      className={`h-2.5 w-2.5 rounded-[2px] ${INTENSITY_CLASSES[day.intensity]} ${onDateClick ? "cursor-pointer" : ""} ${isSelected ? "ring-primary ring-1" : ""}`}
                      onClick={() => onDateClick?.(isSelected ? null : day.date)}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p>{day.date}</p>
                    <p>{formatTokens(day.tokens)} tokens</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}
