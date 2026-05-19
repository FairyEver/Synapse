import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MetricItem {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

interface MetricGridProps {
  readonly metrics: readonly MetricItem[]
}

export function MetricGrid({ metrics }: MetricGridProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {metrics.map((metric) => (
        <Card key={metric.label} size="sm">
          <CardHeader>
            <CardTitle>{metric.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums">{metric.value}</div>
            {metric.subValue ? <div className="text-sm text-muted-foreground">{metric.subValue}</div> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
