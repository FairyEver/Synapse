import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface MetricItem {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

interface MetricGridProps {
  readonly metrics: readonly MetricItem[]
  readonly columns?: "default" | "four"
}

export function MetricGrid({ metrics, columns = "default" }: MetricGridProps) {
  return (
    <div className={cn("grid min-w-0 gap-2", columns === "four" ? "grid-cols-4" : "md:grid-cols-3 xl:grid-cols-6")}>
      {metrics.map((metric) => (
        <Card key={metric.label} size="sm" className="min-w-0 ring-0">
          <CardHeader>
            <CardTitle>{metric.label}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <div className="min-w-0 break-words text-lg font-semibold tabular-nums">{metric.value}</div>
            {metric.subValue ? <div className="min-w-0 break-words text-sm text-muted-foreground">{metric.subValue}</div> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
