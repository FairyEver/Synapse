import { cn } from "@/lib/utils"
import { formatCostUsd, formatTokenUsageValue, normalizeCostUsd, tokenUsageFields } from "@/lib/token-usage"

interface TokenUsageSummaryProps {
  readonly costUsd?: number
  readonly usage?: Record<string, unknown>
  readonly className?: string
  readonly itemClassName?: string
}

function TokenUsageSummary({ costUsd, usage, className, itemClassName }: TokenUsageSummaryProps) {
  const fields = tokenUsageFields(usage)
  const normalizedCostUsd = normalizeCostUsd(costUsd)
  if (!fields && normalizedCostUsd === undefined) return null

  return (
    <span aria-label="Token 消耗" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {fields?.map((field) => (
        <span key={field.label} className={cn("whitespace-nowrap", itemClassName)}>
          {field.label} {formatTokenUsageValue(field.value)}
        </span>
      ))}
      {normalizedCostUsd !== undefined && (
        <span className={cn("whitespace-nowrap", itemClassName)}>
          费用 {formatCostUsd(normalizedCostUsd)}
        </span>
      )}
    </span>
  )
}

export { TokenUsageSummary }
