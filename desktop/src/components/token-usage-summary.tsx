import { cn } from "@/lib/utils"
import { formatSynapseCost, resolveSynapseCostCny } from "@/lib/cost-currency"
import { formatTokenUsageValue, tokenUsageFields } from "@/lib/token-usage"

interface TokenUsageSummaryProps {
  readonly costUsd?: number
  readonly costCny?: number
  readonly costCurrency?: "CNY"
  readonly usage?: Record<string, unknown>
  readonly className?: string
  readonly itemClassName?: string
}

function TokenUsageSummary({ costUsd, costCny, usage, className, itemClassName }: TokenUsageSummaryProps) {
  const fields = tokenUsageFields(usage)
  const normalizedCostCny = resolveSynapseCostCny({ costCny, costUsd })
  if (!fields && normalizedCostCny === undefined) return null

  return (
    <span aria-label="Token 消耗" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {fields?.map((field) => (
        <span key={field.label} className={cn("whitespace-nowrap", itemClassName)}>
          {field.label} {formatTokenUsageValue(field.value)}
        </span>
      ))}
      {normalizedCostCny !== undefined && (
        <span className={cn("whitespace-nowrap", itemClassName)}>
          费用 {formatSynapseCost(normalizedCostCny)}
        </span>
      )}
    </span>
  )
}

export { TokenUsageSummary }
