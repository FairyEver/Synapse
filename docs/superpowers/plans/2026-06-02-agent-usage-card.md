# Agent Usage Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-line Agent token summary with a compact, productized usage statistics card after completed assistant messages.

**Architecture:** Preserve the existing conversation/runtime boundary by storing both per-turn and cumulative usage metadata on assistant history entries. Add Agent-only formatting utilities and an Agent-only card component, then wire it into assistant message rendering without changing shared `TokenUsageSummary` consumers.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/Radix UI primitives, Tailwind token classes.

---

## File Structure

- Modify: `desktop/src/types/agent.ts`
  - Add `turnUsage`, `totalCostCny`, `totalCostUsd`, and `estimatedCost` fields to `SynapseAgentResultMetadata`.
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
  - Preserve the new metadata fields through IPC validation.
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Keep result `usage` as cumulative usage for backward compatibility.
  - Add `turnUsage` for this result.
  - Add cumulative cost fields by summing prior assistant history costs plus this turn.
- Create: `desktop/src/modules/agent/utils/agent-usage-card.ts`
  - Normalize usage into display rows, compute percentages, format copy text, and format costs.
- Create: `desktop/src/modules/agent/utils/__tests__/agent-usage-card.test.ts`
  - Unit tests for normalization, percentage math, cost fallback, and copy text.
- Create: `desktop/src/modules/agent/components/agent-usage-card.tsx`
  - Render the compact, non-wrapping card.
- Create: `desktop/src/modules/agent/components/__tests__/agent-usage-card.test.tsx`
  - Component tests for rendering and copy.
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
  - Render `AgentUsageCard` under assistant content when usage metadata exists.
  - Stop passing usage into `AgentMessageToolbar` for assistant messages.
- Modify: `desktop/src/modules/agent/components/__tests__/agent-message-event.test.tsx`
  - Verify card appears, old inline usage does not repeat, and no card appears without usage.
- Modify: `desktop/src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx`
  - Keep toolbar tests focused on its shared behavior; do not remove shared usage support.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note about the new Agent usage card.

## Task 1: Preserve Per-Turn And Cumulative Metadata

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
- Test: `desktop/src/lib/__tests__/agent-timeline.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Add a test in `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts` near the existing result usage/cost tests:

```ts
it("stores turn usage and cumulative cost on assistant result metadata", async () => {
  const harness = await createHarness()
  const firstUsage = {
    input_tokens: 10,
    output_tokens: 2,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 1,
  }
  const secondUsage = {
    input_tokens: 20,
    output_tokens: 5,
    cache_read_input_tokens: 6,
    cache_creation_input_tokens: 2,
  }

  harness.runtime.enqueue([
    { type: "assistant", content: "first" },
    { type: "result", content: "first", done: true, usage: firstUsage, costUsd: 0.01, costCny: 0.072, costCurrency: "CNY" },
  ])
  await harness.service.send({ sessionKey: "local:renderer", content: "first", agentType: "claude-code" })

  harness.runtime.enqueue([
    { type: "assistant", content: "second" },
    { type: "result", content: "second", done: true, usage: secondUsage, costUsd: 0.02, costCny: 0.144, costCurrency: "CNY" },
  ])
  const result = await harness.service.send({ sessionKey: "local:renderer", content: "second", agentType: "claude-code" })
  const conversation = await harness.repository.requireConversation(result.conversationId)
  const assistant = conversation.history.filter((entry) => entry.role === "assistant").at(-1)

  expect(assistant?.metadata).toMatchObject({
    usage: {
      inputTokens: 30,
      outputTokens: 7,
      cacheReadInputTokens: 9,
      cacheCreationInputTokens: 3,
      totalTokens: 49,
    },
    turnUsage: secondUsage,
    costCny: 0.144,
    totalCostCny: 0.216,
    costCurrency: "CNY",
    estimatedCost: true,
  })
})
```

If the harness helper names differ, reuse the local helpers already used by neighboring tests and keep the assertions unchanged.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts src/lib/__tests__/agent-timeline.test.ts
```

Expected: FAIL because `turnUsage`, `totalCostCny`, and `estimatedCost` are not preserved.

- [ ] **Step 3: Extend result metadata types**

Update `desktop/src/types/agent.ts`:

```ts
export interface SynapseAgentResultMetadata {
  readonly model?: string
  readonly effort?: string
  readonly contextRemainingPercent?: number
  readonly workDir?: string
  readonly cancelled?: boolean
  readonly usage?: Record<string, unknown>
  readonly turnUsage?: Record<string, unknown>
  readonly modelUsage?: Record<string, unknown>
  readonly sdkResultUuid?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly totalCostUsd?: number
  readonly totalCostCny?: number
  readonly costCurrency?: "CNY"
  readonly estimatedCost?: boolean
}
```

Update both `resultMetadataSchema` usages in `desktop/electron/modules/agent/ipc-shared.ts`:

```ts
const resultMetadataSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
  contextRemainingPercent: z.number().optional(),
  workDir: z.string().optional(),
  cancelled: z.boolean().optional(),
  usage: jsonRecordSchema.optional(),
  turnUsage: jsonRecordSchema.optional(),
  costUsd: z.number().optional(),
  costCny: z.number().optional(),
  totalCostUsd: z.number().optional(),
  totalCostCny: z.number().optional(),
  costCurrency: z.literal("CNY").optional(),
  estimatedCost: z.boolean().optional(),
})
```

- [ ] **Step 4: Add cumulative cost helper in conversation router**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add helpers near `cumulativeUsageMetadata()`:

```ts
  private cumulativeCostMetadata(
    conversation: ConversationEntryV1,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): ConversationEntryV1["history"][number]["metadata"] | undefined {
    const turnCostCny = metadataNumber(metadata, "costCny")
    const turnCostUsd = metadataNumber(metadata, "costUsd")
    const previousCostCny = sumAssistantMetadataNumber(conversation.history, "costCny")
    const previousCostUsd = sumAssistantMetadataNumber(conversation.history, "costUsd")
    return compactMetadata({
      ...(metadata ?? {}),
      ...(turnCostCny === undefined ? {} : { totalCostCny: previousCostCny + turnCostCny }),
      ...(turnCostUsd === undefined ? {} : { totalCostUsd: previousCostUsd + turnCostUsd }),
      ...(turnCostCny === undefined && turnCostUsd === undefined ? {} : { estimatedCost: true }),
    })
  }
```

Add file-level helpers near `compactMetadata()`:

```ts
function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function sumAssistantMetadataNumber(
  history: readonly ConversationEntryV1["history"][number][],
  key: string,
): number {
  return history.reduce((total, entry) => {
    if (entry.role !== "assistant") return total
    return total + (metadataNumber(entry.metadata, key) ?? 0)
  }, 0)
}
```

- [ ] **Step 5: Preserve turn usage before cumulative overwrite**

Change `resultHistoryMetadata()` in `desktop/electron/services/agent-runtime/conversation-router.ts` so it stores both:

```ts
function resultHistoryMetadata(
  event: Extract<AgentEvent, { type: "result" }>,
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  const turnUsage = resultUsageFromEvent(event)
  const metadata = compactMetadata({
    ...event.metadata,
    usage: turnUsage,
    turnUsage,
    modelUsage: resultModelUsageFromEvent(event),
    sdkResultUuid: resultSdkResultUuidFromEvent(event),
    costUsd: resultCostFromEvent(event),
    costCny: resultCostCnyFromEvent(event),
    costCurrency: resultCostCurrencyFromEvent(event),
  })
  return Object.keys(metadata).length > 0 ? metadata : undefined
}
```

Then, in both result handling paths where the router currently does:

```ts
resultMetadata = await this.cumulativeUsageMetadata(conversation.id, resultMetadata)
```

replace with:

```ts
resultMetadata = await this.cumulativeUsageMetadata(conversation.id, resultMetadata)
resultMetadata = this.cumulativeCostMetadata(conversation, resultMetadata)
```

- [ ] **Step 6: Run metadata tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts src/lib/__tests__/agent-timeline.test.ts
```

Expected: PASS.

## Task 2: Add Agent Usage Card Utilities

**Files:**
- Create: `desktop/src/modules/agent/utils/agent-usage-card.ts`
- Create: `desktop/src/modules/agent/utils/__tests__/agent-usage-card.test.ts`

- [ ] **Step 1: Write utility tests**

Create `desktop/src/modules/agent/utils/__tests__/agent-usage-card.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildAgentUsageCardData,
  formatAgentUsageCopyText,
} from "../agent-usage-card"

describe("agent usage card utilities", () => {
  it("builds rows with totals deltas and percentages", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 20,
        reasoningOutputTokens: 10,
        totalTokens: 380,
      },
      turnUsage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 2,
      },
      turnCostCny: 0.18,
      totalCostCny: 1.42,
      estimatedCost: true,
      timestamp: "2026-06-02T06:32:00.000Z",
    })

    expect(data?.rows.map((row) => ({
      key: row.key,
      total: row.total,
      delta: row.delta,
      percent: row.percent,
    }))).toEqual([
      { key: "input", total: 100, delta: 20, percent: 20 },
      { key: "output", total: 50, delta: 5, percent: 10 },
      { key: "cacheRead", total: 200, delta: 40, percent: 20 },
      { key: "cacheWrite", total: 20, delta: 0, percent: 0 },
      { key: "reasoning", total: 10, delta: 2, percent: 20 },
    ])
    expect(data?.turnCostLabel).toBe("¥0.18")
    expect(data?.totalCostLabel).toBe("¥1.42")
  })

  it("omits reasoning when neither total nor turn contains reasoning", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        totalTokens: 10,
      },
      turnUsage: {
        input_tokens: 1,
        output_tokens: 2,
      },
    })

    expect(data?.rows.map((row) => row.key)).toEqual(["input", "output", "cacheRead", "cacheWrite"])
  })

  it("formats copy text without undefined or NaN", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 10248,
        outputTokens: 3812,
        cacheReadInputTokens: 42180,
        cacheCreationInputTokens: 1216,
        reasoningOutputTokens: 680,
        totalTokens: 58136,
      },
      turnUsage: {
        input_tokens: 2104,
        output_tokens: 846,
        cache_read_input_tokens: 9640,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 180,
      },
      turnCostCny: 0.18,
      totalCostCny: 1.42,
      estimatedCost: true,
    })

    const text = formatAgentUsageCopyText(data)
    expect(text).toContain("用量统计")
    expect(text).toContain("输入 10,248（本轮 +2,104，占累计 21%）")
    expect(text).toContain("价格按当前模型估算")
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("NaN")
  })
})
```

- [ ] **Step 2: Run failing utility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/utils/__tests__/agent-usage-card.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement utilities**

Create `desktop/src/modules/agent/utils/agent-usage-card.ts`:

```ts
import { formatSynapseCost } from "@/lib/cost-currency"
import { formatTokenUsageValue, normalizeClaudeSdkUsage, type ClaudeSdkUsageSummary } from "@/lib/token-usage"

export type AgentUsageRowKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

export interface AgentUsageCardRow {
  readonly key: AgentUsageRowKey
  readonly label: string
  readonly total: number
  readonly delta?: number
  readonly percent?: number
}

export interface AgentUsageCardData {
  readonly rows: readonly AgentUsageCardRow[]
  readonly turnCostLabel?: string
  readonly totalCostLabel?: string
  readonly estimatedCost: boolean
  readonly timestamp?: string
}

export interface BuildAgentUsageCardInput {
  readonly totalUsage?: Record<string, unknown> | ClaudeSdkUsageSummary
  readonly turnUsage?: Record<string, unknown>
  readonly turnCostCny?: number
  readonly totalCostCny?: number
  readonly estimatedCost?: boolean
  readonly timestamp?: string
}

const rowDefinitions: readonly {
  readonly key: AgentUsageRowKey
  readonly label: string
  readonly totalKey: keyof ClaudeSdkUsageSummary
  readonly turnKey: keyof ClaudeSdkUsageSummary
  readonly optional?: boolean
}[] = [
  { key: "input", label: "输入", totalKey: "inputTokens", turnKey: "inputTokens" },
  { key: "output", label: "输出", totalKey: "outputTokens", turnKey: "outputTokens" },
  { key: "cacheRead", label: "缓存读", totalKey: "cacheReadInputTokens", turnKey: "cacheReadInputTokens" },
  { key: "cacheWrite", label: "缓存写", totalKey: "cacheCreationInputTokens", turnKey: "cacheCreationInputTokens" },
  { key: "reasoning", label: "思考", totalKey: "reasoningOutputTokens", turnKey: "reasoningOutputTokens", optional: true },
]

export function buildAgentUsageCardData(input: BuildAgentUsageCardInput): AgentUsageCardData | undefined {
  const total = normalizeUsageSummary(input.totalUsage)
  if (!total) return undefined
  const turn = normalizeUsageSummary(input.turnUsage)
  const rows = rowDefinitions.flatMap((definition) => {
    const totalValue = tokenValue(total[definition.totalKey])
    const deltaValue = turn ? tokenValue(turn[definition.turnKey]) : undefined
    if (definition.optional && totalValue === 0 && deltaValue === undefined) return []
    return [{
      key: definition.key,
      label: definition.label,
      total: totalValue,
      delta: deltaValue,
      percent: deltaValue === undefined ? undefined : percentage(deltaValue, totalValue),
    }]
  })
  if (rows.length === 0) return undefined
  return {
    rows,
    turnCostLabel: costLabel(input.turnCostCny),
    totalCostLabel: costLabel(input.totalCostCny),
    estimatedCost: input.estimatedCost === true || input.turnCostCny !== undefined || input.totalCostCny !== undefined,
    timestamp: input.timestamp,
  }
}

export function formatAgentUsageCopyText(data: AgentUsageCardData | undefined): string {
  if (!data) return ""
  const costs = [
    data.turnCostLabel ? `本轮费用 ${data.turnCostLabel}` : undefined,
    data.totalCostLabel ? `会话累计费用 ${data.totalCostLabel}` : undefined,
  ].filter(Boolean).join("，")
  const rows = data.rows.map((row) => {
    const details = [
      row.delta === undefined ? undefined : `本轮 +${formatTokenUsageValue(row.delta)}`,
      row.percent === undefined ? undefined : `占累计 ${row.percent}%`,
    ].filter(Boolean).join("，")
    return `${row.label} ${formatTokenUsageValue(row.total)}${details ? `（${details}）` : ""}`
  }).join("、")
  return [
    `用量统计${costs ? `：${costs}。` : "。"}`,
    `Token 累计：${rows}。`,
    data.estimatedCost ? "价格按当前模型估算。" : undefined,
  ].filter(Boolean).join("\n")
}

function normalizeUsageSummary(usage: BuildAgentUsageCardInput["totalUsage"]): ClaudeSdkUsageSummary | undefined {
  if (!usage) return undefined
  if (isClaudeSdkUsageSummary(usage)) return usage
  return normalizeClaudeSdkUsage(usage)
}

function isClaudeSdkUsageSummary(value: Record<string, unknown>): value is ClaudeSdkUsageSummary {
  return typeof value.inputTokens === "number"
    && typeof value.outputTokens === "number"
    && typeof value.cacheReadInputTokens === "number"
    && typeof value.cacheCreationInputTokens === "number"
    && typeof value.totalTokens === "number"
}

function tokenValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function percentage(delta: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((delta / total) * 100)
}

function costLabel(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? formatSynapseCost(value)
    : undefined
}
```

- [ ] **Step 4: Run utility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/utils/__tests__/agent-usage-card.test.ts
```

Expected: PASS.

## Task 3: Build The Agent Usage Card Component

**Files:**
- Create: `desktop/src/modules/agent/components/agent-usage-card.tsx`
- Create: `desktop/src/modules/agent/components/__tests__/agent-usage-card.test.tsx`

- [ ] **Step 1: Write component tests**

Create `desktop/src/modules/agent/components/__tests__/agent-usage-card.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentUsageCard } from "../agent-usage-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("AgentUsageCard", () => {
  it("renders compact usage rows and costs", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          timestamp="2026-06-02T06:32:00.000Z"
          totalUsage={{
            inputTokens: 10248,
            outputTokens: 3812,
            cacheReadInputTokens: 42180,
            cacheCreationInputTokens: 1216,
            reasoningOutputTokens: 680,
            totalTokens: 58136,
          }}
          turnUsage={{
            input_tokens: 2104,
            output_tokens: 846,
            cache_read_input_tokens: 9640,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 180,
          }}
          turnCostCny={0.18}
          totalCostCny={1.42}
          estimatedCost
        />
      )
    })

    expect(container.textContent).toContain("用量统计")
    expect(container.textContent).toContain("本轮")
    expect(container.textContent).toContain("¥0.18")
    expect(container.textContent).toContain("累计")
    expect(container.textContent).toContain("¥1.42")
    expect(container.textContent).toContain("输入")
    expect(container.textContent).toContain("10,248")
    expect(container.textContent).toContain("+2,104")
    expect(container.textContent).toContain("21%")
    expect(container.textContent).toContain("最近 5 轮")
  })

  it("copies a human readable usage summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 10248,
            outputTokens: 3812,
            cacheReadInputTokens: 42180,
            cacheCreationInputTokens: 1216,
            reasoningOutputTokens: 680,
            totalTokens: 58136,
          }}
          turnUsage={{ input_tokens: 2104 }}
          turnCostCny={0.18}
          totalCostCny={1.42}
          estimatedCost
        />
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-label='复制用量统计']")?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("用量统计"))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Token 累计"))
    expect(writeText.mock.calls[0]?.[0]).not.toContain("undefined")
    expect(writeText.mock.calls[0]?.[0]).not.toContain("NaN")
  })
})
```

- [ ] **Step 2: Run failing component tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-usage-card.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement component**

Create `desktop/src/modules/agent/components/agent-usage-card.tsx`:

```tsx
import { Check, Clipboard, Info } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTokenUsageValue } from "@/lib/token-usage"
import { cn } from "@/lib/utils"
import {
  buildAgentUsageCardData,
  formatAgentUsageCopyText,
  type AgentUsageRowKey,
} from "../utils/agent-usage-card"

interface AgentUsageCardProps {
  readonly totalUsage?: Record<string, unknown>
  readonly turnUsage?: Record<string, unknown>
  readonly turnCostCny?: number
  readonly totalCostCny?: number
  readonly estimatedCost?: boolean
  readonly timestamp?: string
  readonly className?: string
}

const rowColorClass: Record<AgentUsageRowKey, string> = {
  input: "bg-chart-1",
  output: "bg-chart-3",
  cacheRead: "bg-chart-5",
  cacheWrite: "bg-chart-4",
  reasoning: "bg-chart-2",
}

function AgentUsageCard(props: AgentUsageCardProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const data = useMemo(() => buildAgentUsageCardData({
    totalUsage: props.totalUsage,
    turnUsage: props.turnUsage,
    turnCostCny: props.turnCostCny,
    totalCostCny: props.totalCostCny,
    estimatedCost: props.estimatedCost,
    timestamp: props.timestamp,
  }), [props.estimatedCost, props.timestamp, props.totalCostCny, props.totalUsage, props.turnCostCny, props.turnUsage])

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  if (!data) return null
  const copyText = formatAgentUsageCopyText(data)

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      setCopied(true)
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = undefined
        setCopied(false)
      }, 1200)
    }).catch(() => {
      toast("复制失败")
    })
  }

  return (
    <section
      aria-label="用量统计"
      className={cn("mt-2 w-[76ch] min-w-[760px] overflow-hidden rounded-lg border border-border bg-card text-card-foreground", props.className)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-semibold">用量统计</span>
          {data.turnCostLabel ? <span className="text-muted-foreground">本轮 <strong className="font-semibold text-foreground">{data.turnCostLabel}</strong></span> : null}
          {data.totalCostLabel ? <span className="text-muted-foreground">累计 <strong className="font-semibold text-foreground">{data.totalCostLabel}</strong></span> : null}
          {data.estimatedCost ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    估算 <Info className="size-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>价格按当前模型估算</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {data.timestamp ? <time>{formatTime(data.timestamp)}</time> : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="复制用量统计" onClick={handleCopy}>
            {copied ? <Check /> : <Clipboard />}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_8.25rem]">
        <div className="border-r border-border px-2.5 py-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {data.rows.map((row) => (
              <span
                key={row.key}
                className={cn("min-w-0", rowColorClass[row.key])}
                style={{ flexBasis: `${Math.max(1, Math.round((row.total / Math.max(1, data.rows.reduce((sum, item) => sum + item.total, 0))) * 100))}%` }}
              />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[5.75rem_5.4rem_7.25rem_5.5rem_4.875rem]">
            {data.rows.map((row, index) => (
              <div key={row.key} className={cn("min-w-0 px-2", index === 0 ? "pl-0" : "border-l border-border", index === data.rows.length - 1 ? "pr-0" : undefined)}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", rowColorClass[row.key])} />
                  <span>{row.label}</span>
                </div>
                <div className="mt-1 truncate text-lg font-semibold leading-none">{formatTokenUsageValue(row.total)}</div>
                <div className="mt-1 flex justify-between gap-1 text-xs text-muted-foreground">
                  <span>{row.delta === undefined ? "--" : `+${formatTokenUsageValue(row.delta)}`}</span>
                  <span>{row.percent === undefined ? "--" : `${row.percent}%`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center px-2.5 py-2">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">最近 5 轮</div>
          <div className="grid h-20 grid-cols-5 items-end gap-1.5 border-b border-border px-0.5">
            {[38, 45, 54, 61, 69].map((height, index) => (
              <div key={index} className="flex min-w-2 flex-col-reverse overflow-hidden rounded-t-sm bg-muted" style={{ height }}>
                <span className="h-[30%] bg-chart-1" />
                <span className="h-[15%] bg-chart-3" />
                <span className="h-[42%] bg-chart-5" />
                <span className="h-[8%] bg-chart-4" />
                <span className="h-[5%] bg-chart-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function formatTime(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`
}

export { AgentUsageCard }
export type { AgentUsageCardProps }
```

Note: the inline `style` values above are dynamic chart dimensions only. They are allowed by the project rule for dynamic runtime values. Keep all colors in token classes.

- [ ] **Step 4: Run component tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-usage-card.test.tsx
```

Expected: PASS.

## Task 4: Wire The Card Into Assistant Messages

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-message-event.test.tsx`

- [ ] **Step 1: Add message rendering tests**

Append these tests to `desktop/src/modules/agent/components/__tests__/agent-message-event.test.tsx`:

```tsx
it("renders an Agent usage card for assistant messages with usage metadata", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AgentMessageEvent
        item={{
          id: "message-usage-card",
          kind: "message",
          role: "assistant",
          content: "Done",
          timestamp: "2026-06-02T06:32:00.000Z",
          metadata: {
            usage: {
              inputTokens: 10248,
              outputTokens: 3812,
              cacheReadInputTokens: 42180,
              cacheCreationInputTokens: 1216,
              reasoningOutputTokens: 680,
              totalTokens: 58136,
            },
            turnUsage: {
              input_tokens: 2104,
              output_tokens: 846,
              cache_read_input_tokens: 9640,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 180,
            },
            costCny: 0.18,
            totalCostCny: 1.42,
            estimatedCost: true,
          },
        }}
        profile={profile}
        onOpenReference={vi.fn()}
      />
    )
  })

  expect(container.textContent).toContain("用量统计")
  expect(container.textContent).toContain("¥0.18")
  expect(container.textContent).toContain("¥1.42")
  expect(container.textContent).toContain("10,248")
  expect(container.textContent).not.toContain("会话累计 输入")
})

it("does not render an Agent usage card without usage metadata", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AgentMessageEvent
        item={{
          id: "message-no-usage-card",
          kind: "message",
          role: "assistant",
          content: "Done",
          timestamp: "2026-06-02T06:32:00.000Z",
        }}
        profile={profile}
        onOpenReference={vi.fn()}
      />
    )
  })

  expect(container.textContent).not.toContain("用量统计")
})
```

- [ ] **Step 2: Run failing message tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-message-event.test.tsx
```

Expected: FAIL because `AgentUsageCard` is not rendered.

- [ ] **Step 3: Render card in assistant message body**

In `desktop/src/modules/agent/components/agent-message-event.tsx`, import the card:

```ts
import { AgentUsageCard } from "./agent-usage-card"
```

Replace the assistant toolbar usage handling:

```tsx
const hasUsage = Boolean(item.metadata?.usage)
```

with:

```tsx
const hasUsage = Boolean(item.metadata?.usage)
```

Then render the card before the toolbar:

```tsx
      {hasUsage ? (
        <AgentUsageCard
          totalUsage={item.metadata?.usage}
          turnUsage={item.metadata?.turnUsage}
          turnCostCny={item.metadata?.costCny}
          totalCostCny={item.metadata?.totalCostCny}
          estimatedCost={item.metadata?.estimatedCost}
          timestamp={item.timestamp}
        />
      ) : null}
      <AgentMessageToolbar
        timestamp={item.timestamp}
        content={item.content}
        messageId={item.id}
        role={item.role === "user" || item.role === "assistant" ? item.role : undefined}
        className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
```

Do not pass `usage` or `usagePrefix` to `AgentMessageToolbar` for assistant messages.

- [ ] **Step 4: Run message tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-message-event.test.tsx src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx
```

Expected: PASS. Toolbar shared tests still pass because `AgentMessageToolbar` retains its usage props for other callers.

## Task 5: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise bullet to `RELEASE_NOTES_PENDING.md`:

```md
- Agent 对话完成后会显示新的用量统计卡片，集中展示本轮费用、会话累计费用、各类 token 累计和本轮增量，复制时也会生成可读摘要。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/conversation-router.test.ts \
  src/lib/__tests__/agent-timeline.test.ts \
  src/modules/agent/utils/__tests__/agent-usage-card.test.ts \
  src/modules/agent/components/__tests__/agent-usage-card.test.tsx \
  src/modules/agent/components/__tests__/agent-message-event.test.tsx \
  src/modules/agent/components/__tests__/agent-message-toolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run style discipline scan**

Run:

```bash
rg -n "style=\\{(?!\\{ height \\}|\\{ flexBasis \\})|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" \
  desktop/src/modules/agent desktop/src/components/token-usage-summary.tsx
```

Expected: no new violations. The only acceptable `style={{ ... }}` in the new card is dynamic chart sizing for `height` and `flexBasis`.

- [ ] **Step 4: Run hard constraints if Electron metadata changed**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Self-review final diff**

Run:

```bash
git diff -- \
  desktop/src/types/agent.ts \
  desktop/electron/modules/agent/ipc-shared.ts \
  desktop/electron/services/agent-runtime/conversation-router.ts \
  desktop/src/modules/agent \
  RELEASE_NOTES_PENDING.md
```

Confirm:

- `用量统计` is the card title.
- No model name is appended after the title.
- Toolbar no longer repeats `会话累计` usage on assistant messages.
- Copy text is human-readable.
- No token, authorization, cookie, or raw secret data is added to logs.

## Self-Review

- Spec coverage: metadata persistence is covered by Task 1; display math and copy text by Task 2; productized UI by Task 3; message integration by Task 4; release note and verification by Task 5.
- Placeholder scan: no task relies on TBD/TODO or unspecified behavior.
- Type consistency: `usage` remains cumulative; `turnUsage` is per-turn; `costCny` is per-turn; `totalCostCny` is cumulative; `estimatedCost` is boolean.
