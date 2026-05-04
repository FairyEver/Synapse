import type {
  GraphResult, DataSummary, DailyContribution, ModelUsage,
  TokenBreakdown, ClientContribution,
} from "./parsers/types"
import { queryDailyRowsFiltered } from "./db"
import { estimateCost } from "./pricing"

interface DailyRow {
  date: string
  client: string
  model_id: string
  provider_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  message_count: number
  turn_count: number
  cost_usd: number
}

function rowCost(r: DailyRow): number {
  if (r.cost_usd > 0) return r.cost_usd
  return estimateCost(r.model_id, {
    input: r.input_tokens, output: r.output_tokens,
    cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens,
  })
}

export function getGraphResult(options?: { since?: string; until?: string }): GraphResult {
  const start = Date.now()
  const rows = queryDailyRowsFiltered(options?.since, options?.until) as unknown as DailyRow[]

  const byDate = new Map<string, DailyRow[]>()
  for (const row of rows) {
    const existing = byDate.get(row.date) || []
    existing.push(row)
    byDate.set(row.date, existing)
  }

  const dailyTotals: { date: string; tokens: number; cost: number }[] = []
  const contributions: DailyContribution[] = []
  const allClients = new Set<string>()
  const allModels = new Set<string>()
  let totalTokens = 0
  let totalCost = 0
  let maxDayCost = 0

  for (const [date, dateRows] of byDate) {
    let dayTokens = 0
    let dayCost = 0
    let dayMessages = 0
    const breakdown: TokenBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
    const clients: ClientContribution[] = []

    for (const r of dateRows) {
      const rowTokens = r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens + r.reasoning_tokens
      dayTokens += rowTokens
      const cost = rowCost(r)
      dayCost += cost
      dayMessages += r.message_count
      breakdown.input += r.input_tokens
      breakdown.output += r.output_tokens
      breakdown.cacheRead += r.cache_read_tokens
      breakdown.cacheWrite += r.cache_write_tokens
      breakdown.reasoning += r.reasoning_tokens
      allClients.add(r.client)
      allModels.add(r.model_id)
      clients.push({
        client: r.client, modelId: r.model_id, providerId: r.provider_id,
        tokens: { input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens, reasoning: r.reasoning_tokens },
        cost, messages: r.message_count,
      })
    }

    totalTokens += dayTokens
    totalCost += dayCost
    maxDayCost = Math.max(maxDayCost, dayCost)
    dailyTotals.push({ date, tokens: dayTokens, cost: dayCost })
    contributions.push({
      date, totals: { tokens: dayTokens, cost: dayCost, messages: dayMessages },
      intensity: 0, tokenBreakdown: breakdown, clients,
    })
  }

  const sorted = [...dailyTotals].filter((d) => d.tokens > 0).sort((a, b) => a.tokens - b.tokens)
  if (sorted.length > 0) {
    const thresholds = [0.25, 0.5, 0.75].map((p) => sorted[Math.floor(p * (sorted.length - 1))].tokens)
    for (const c of contributions) {
      if (c.totals.tokens === 0) c.intensity = 0
      else if (c.totals.tokens <= thresholds[0]) c.intensity = 1
      else if (c.totals.tokens <= thresholds[1]) c.intensity = 2
      else if (c.totals.tokens <= thresholds[2]) c.intensity = 3
      else c.intensity = 4
    }
  }

  const yearMap = new Map<string, { tokens: number; cost: number }>()
  for (const d of dailyTotals) {
    const year = d.date.slice(0, 4)
    const existing = yearMap.get(year) || { tokens: 0, cost: 0 }
    existing.tokens += d.tokens
    existing.cost += d.cost
    yearMap.set(year, existing)
  }

  const activeDays = contributions.filter((c) => c.totals.tokens > 0).length
  const summary: DataSummary = {
    totalTokens, totalCost,
    totalDays: contributions.length,
    activeDays,
    averagePerDay: activeDays > 0 ? totalTokens / activeDays : 0,
    maxCostInSingleDay: maxDayCost,
    clients: [...allClients],
    models: [...allModels],
  }

  return {
    meta: { generatedAt: new Date().toISOString(), processingTimeMs: Date.now() - start },
    summary,
    years: [...yearMap.entries()].map(([year, v]) => ({ year, totalTokens: v.tokens, totalCost: v.cost })),
    contributions,
  }
}

export function getModelReport(options?: { since?: string; until?: string }): ModelUsage[] {
  const rows = queryDailyRowsFiltered(options?.since, options?.until) as unknown as DailyRow[]

  const modelMap = new Map<string, ModelUsage>()
  for (const r of rows) {
    const key = `${r.client}:${r.model_id}:${r.provider_id}`
    const cost = rowCost(r)
    const existing = modelMap.get(key)
    if (existing) {
      existing.input += r.input_tokens
      existing.output += r.output_tokens
      existing.cacheRead += r.cache_read_tokens
      existing.cacheWrite += r.cache_write_tokens
      existing.reasoning += r.reasoning_tokens
      existing.messageCount += r.message_count
      existing.cost += cost
    } else {
      modelMap.set(key, {
        client: r.client, model: r.model_id, provider: r.provider_id,
        input: r.input_tokens, output: r.output_tokens,
        cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens,
        reasoning: r.reasoning_tokens, messageCount: r.message_count, cost,
      })
    }
  }

  return [...modelMap.values()].sort((a, b) => {
    const totalA = a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning
    const totalB = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
    return totalB - totalA
  })
}

export interface AgentUsage {
  client: string
  models: string[]
  providers: string[]
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  cost: number
  activeDays: number
  firstSeen: string
  lastSeen: string
}

export function getAgentReport(options?: { since?: string; until?: string }): AgentUsage[] {
  const rows = queryDailyRowsFiltered(options?.since, options?.until) as unknown as DailyRow[]

  const agentMap = new Map<string, {
    models: Set<string>; providers: Set<string>; dates: Set<string>
    input: number; output: number; cacheRead: number; cacheWrite: number
    reasoning: number; messageCount: number; cost: number
    firstSeen: string; lastSeen: string
  }>()

  for (const r of rows) {
    const cost = rowCost(r)
    const existing = agentMap.get(r.client)
    if (existing) {
      existing.models.add(r.model_id)
      existing.providers.add(r.provider_id)
      existing.dates.add(r.date)
      existing.input += r.input_tokens
      existing.output += r.output_tokens
      existing.cacheRead += r.cache_read_tokens
      existing.cacheWrite += r.cache_write_tokens
      existing.reasoning += r.reasoning_tokens
      existing.messageCount += r.message_count
      existing.cost += cost
      if (r.date < existing.firstSeen) existing.firstSeen = r.date
      if (r.date > existing.lastSeen) existing.lastSeen = r.date
    } else {
      agentMap.set(r.client, {
        models: new Set([r.model_id]), providers: new Set([r.provider_id]),
        dates: new Set([r.date]),
        input: r.input_tokens, output: r.output_tokens,
        cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens,
        reasoning: r.reasoning_tokens, messageCount: r.message_count, cost,
        firstSeen: r.date, lastSeen: r.date,
      })
    }
  }

  return [...agentMap.entries()]
    .map(([client, a]) => ({
      client,
      models: [...a.models],
      providers: [...a.providers],
      input: a.input, output: a.output, cacheRead: a.cacheRead,
      cacheWrite: a.cacheWrite, reasoning: a.reasoning,
      messageCount: a.messageCount, cost: a.cost,
      activeDays: a.dates.size, firstSeen: a.firstSeen, lastSeen: a.lastSeen,
    }))
    .sort((a, b) => {
      const totalA = a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning
      const totalB = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
      return totalB - totalA
    })
}

export function getDailyReport(options?: { since?: string; until?: string }): Record<string, unknown>[] {
  const rows = queryDailyRowsFiltered(options?.since, options?.until) as unknown as DailyRow[]

  const dayMap = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; messages: number; turns: number; cost: number }>()
  for (const r of rows) {
    const cost = rowCost(r)
    const existing = dayMap.get(r.date)
    if (existing) {
      existing.input += r.input_tokens
      existing.output += r.output_tokens
      existing.cacheRead += r.cache_read_tokens
      existing.cacheWrite += r.cache_write_tokens
      existing.reasoning += r.reasoning_tokens
      existing.messages += r.message_count
      existing.turns += r.turn_count
      existing.cost += cost
    } else {
      dayMap.set(r.date, {
        input: r.input_tokens, output: r.output_tokens,
        cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens,
        reasoning: r.reasoning_tokens, messages: r.message_count,
        turns: r.turn_count, cost,
      })
    }
  }

  return [...dayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, d]) => ({ date, ...d }))
}
