import { cn } from "@/lib/utils"
import { formatTokenUsageValue, tokenUsageFields } from "@/lib/token-usage"

interface TokenUsageSummaryProps {
  readonly usage?: Record<string, unknown>
  readonly costUsd?: number
  readonly prefix?: string
  readonly className?: string
  readonly itemClassName?: string
}

function TokenUsageSummary({ usage, costUsd, prefix, className, itemClassName }: TokenUsageSummaryProps) {
  const fields = tokenUsageFieldsWithCost(usage, costUsd, { prefix })
  if (!fields) return null

  return (
    <span aria-label="Token 消耗" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {fields?.map((field) => (
        <span key={field.label} className={cn("whitespace-nowrap", itemClassName)}>
          {field.label}{field.value !== undefined ? ` ${formatTokenUsageFieldValue(field.value)}` : null}
        </span>
      ))}
    </span>
  )
}

function tokenUsageFieldsWithCost(
  usage: Record<string, unknown> | undefined,
  costUsd: number | undefined,
  options: { readonly prefix?: string },
): readonly { readonly label: string; readonly value?: number | string }[] | undefined {
  const fields = tokenUsageFields(usage, options) ?? []
  const cost = formatUsdCost(costUsd)
  const next = cost ? [...fields, { label: "费用", value: cost }] : fields
  return next.length > 0 ? next : undefined
}

function formatUsdCost(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  const digits = value > 0 && value < 0.01 ? 4 : 2
  return `$${value.toFixed(digits)}`
}

function formatTokenUsageFieldValue(value: number | string): string {
  return typeof value === "number" ? formatTokenUsageValue(value) : value
}

export { TokenUsageSummary }
