import { cn } from "@/lib/utils"
import { formatTokenUsageValue, tokenUsageFields } from "@/lib/token-usage"

interface TokenUsageSummaryProps {
  readonly usage?: Record<string, unknown>
  readonly className?: string
  readonly itemClassName?: string
}

function TokenUsageSummary({ usage, className, itemClassName }: TokenUsageSummaryProps) {
  const fields = tokenUsageFields(usage)
  if (!fields) return null

  return (
    <span aria-label="Token 消耗" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {fields?.map((field) => (
        <span key={field.label} className={cn("whitespace-nowrap", itemClassName)}>
          {field.label}{field.value !== undefined ? ` ${formatTokenUsageValue(field.value)}` : null}
        </span>
      ))}
    </span>
  )
}

export { TokenUsageSummary }
