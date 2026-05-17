import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
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
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
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
                      className={cn(
                        "size-2.5 rounded-sm",
                        INTENSITY_CLASSES[day.intensity],
                        onDateClick ? "cursor-pointer" : null,
                        isSelected ? "ring-primary ring-1" : null,
                      )}
                      onClick={() => onDateClick?.(isSelected ? null : day.date)}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p>{day.date}</p>
                    <p>{formatTokens(day.tokens)} Token</p>
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
