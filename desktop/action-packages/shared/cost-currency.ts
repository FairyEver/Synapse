export const SYNAPSE_COST_CURRENCY = "CNY" as const
export const USD_TO_CNY_RATE = 7.2

export type SynapseCostCurrency = typeof SYNAPSE_COST_CURRENCY

const costFormatter = new Intl.NumberFormat("zh-CN", {
  currency: SYNAPSE_COST_CURRENCY,
  maximumFractionDigits: 6,
  minimumFractionDigits: 2,
  style: "currency",
})

export function usdToCny(value: number): number {
  return value * USD_TO_CNY_RATE
}

export function normalizeCostCny(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return value
}

export function resolveSynapseCostCny(input: {
  readonly costCny?: unknown
  readonly costUsd?: unknown
}): number | undefined {
  const cny = normalizeCostCny(input.costCny)
  if (cny !== undefined) return cny
  const usd = normalizeCostCny(input.costUsd)
  return usd === undefined ? undefined : usdToCny(usd)
}

export function formatSynapseCost(value: number): string {
  return costFormatter.format(value)
}
