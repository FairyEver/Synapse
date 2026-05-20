# Usage Analysis Today Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent `今日` page to both CC and Codex usage analysis that shows current-day usage from local midnight to now, with no historical range picker and no tool/project/command rankings.

**Architecture:** Extend the existing usage range preset with `today`, keep the existing Electron usage reports as the data source, and add a renderer-only today report view that composes overview/time/model data into a separate day-in-progress dashboard. The existing `概览`, `时间`, `模型`, `项目`, and `工具` pages remain unchanged except for navigation/range visibility.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/ui, ECharts, Vitest.

---

## File Structure

- Modify `desktop/electron/services/usage-analysis/types.ts`: add the `today` range preset.
- Modify `desktop/electron/services/usage-analysis/range.ts`: resolve `today` to the current local date.
- Modify `desktop/electron/usage-analysis/ipc-handlers.ts`: accept `today` during IPC normalization and export the normalizer for tests.
- Modify `desktop/src/types/bridge.ts`: add `today` to renderer bridge range typing.
- Modify `desktop/src/modules/usage-analysis/shared/types.ts`: add `today` to the view union by changing `UsageViewId`.
- Modify `desktop/src/modules/usage-analysis/shared/range.ts`: keep historical range picker options unchanged; `today` is a view tab, not a range picker option.
- Modify `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`: add `今日` as the first tab and hide `RangePicker` on that tab.
- Modify `desktop/src/modules/usage-analysis/shared/components/usage-charts.tsx`: add a today-specific hourly composition chart.
- Create `desktop/src/modules/usage-analysis/shared/today.ts`: pure helpers for today metrics, projection, structure summaries, and chart row shaping.
- Create `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`: independent today page layout.
- Modify `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`: default to `today` and render `TodayReportView` with CC hooks.
- Modify `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`: default to `today` and render `TodayReportView` with Codex hooks.
- Modify tests under `desktop/electron/services/usage-analysis/__tests__/`, `desktop/src/modules/usage-analysis/__tests__/`, and `desktop/electron/usage-analysis/__tests__/` as described below.

## Task 1: Lock The `today` Range Contract

**Files:**
- Modify: `desktop/electron/services/usage-analysis/types.ts`
- Modify: `desktop/electron/services/usage-analysis/range.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/range.test.ts`
- Modify: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Create: `desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add failing range tests**

Add these tests to `desktop/electron/services/usage-analysis/__tests__/range.test.ts`:

```ts
it("creates a local current-day window for today", () => {
  expect(createUsageRangeFilter({ preset: "today" }, new Date("2026-05-20T15:30:00+08:00"))).toEqual({
    sinceDate: "2026-05-20",
    untilDate: "2026-05-20",
  })
})
```

Create `desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalizeUsageRangeForIpc } from "../ipc-handlers"

describe("usage analysis ipc handlers", () => {
  it("accepts today range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "today" })).toEqual({ preset: "today" })
  })

  it("falls back to 30d for unknown range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "bad" as never })).toEqual({ preset: "30d" })
  })
})
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/range.test.ts electron/usage-analysis/__tests__/ipc-handlers.test.ts
```

Expected: FAIL because `today` is not part of the preset union and the exported IPC normalizer does not exist.

- [ ] **Step 3: Add `today` to main-process types**

Change `desktop/electron/services/usage-analysis/types.ts`:

```ts
export type UsageRangePreset = "today" | "7d" | "30d" | "90d" | "all"
```

- [ ] **Step 4: Implement `today` range filtering**

Change `desktop/electron/services/usage-analysis/range.ts` so `today` is handled before `RANGE_DAYS`:

```ts
const RANGE_DAYS: Record<Exclude<UsageRangeInput["preset"], "today" | "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

export function createUsageRangeFilter(input: UsageRangeInput, now = new Date()): UsageRangeFilter {
  if (input.preset === "all") return {}
  if (input.preset === "today") {
    const today = localDateKey(now.getTime())
    return {
      sinceDate: today,
      untilDate: today,
    }
  }
  const days = RANGE_DAYS[input.preset]
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  return {
    sinceDate: localDateKey(start.getTime()),
    untilDate: localDateKey(end.getTime()),
  }
}
```

- [ ] **Step 5: Export and extend IPC range normalization**

Change `desktop/electron/usage-analysis/ipc-handlers.ts`:

```ts
const USAGE_RANGE_PRESETS = new Set(["today", "7d", "30d", "90d", "all"])

export function normalizeUsageRangeForIpc(range: UsageRangeInput | undefined): UsageRangeInput {
  if (range && USAGE_RANGE_PRESETS.has(range.preset)) {
    return range
  }
  return { preset: "30d" }
}
```

Then update all handler calls from `normalizeRange(range)` to `normalizeUsageRangeForIpc(range)`.

Update details normalization:

```ts
function normalizeDetailsRange(range: UsageDetailInput | undefined): UsageDetailInput {
  const normalized = normalizeUsageRangeForIpc(range)
  const limit = Number(range?.limit)
  const offset = Number(range?.offset)
  return {
    ...normalized,
    limit: Number.isFinite(limit) ? limit : 200,
    offset: Number.isFinite(offset) ? offset : 0,
  }
}
```

- [ ] **Step 6: Add `today` to bridge types**

Change `desktop/src/types/bridge.ts`:

```ts
export type UsageAnalysisRangePreset = "today" | "7d" | "30d" | "90d" | "all"
```

- [ ] **Step 7: Run tests and verify green**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/range.test.ts electron/usage-analysis/__tests__/ipc-handlers.test.ts
```

Expected: PASS.

## Task 2: Make Time Reports Hourly For Today

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Add failing report test**

Add this test to `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`:

```ts
it("serves today time report from hourly buckets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
  tempDirs.push(dir)
  const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
  fs.mkdirSync(projectDir, { recursive: true })
  const firstHour = new Date(2026, 4, 20, 9, 10).toISOString()
  const secondHour = new Date(2026, 4, 20, 10, 20).toISOString()
  fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "assistant",
      timestamp: firstHour,
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: secondHour,
      message: {
        role: "assistant",
        model: "claude-haiku-4.5",
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    }),
  ].join("\n"))

  const db = getUsageAnalysisDb(dir)
  const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
  await service.refresh()

  const rows = service.getTime({ preset: "today" })

  expect(rows.map((row) => row.bucket)).toEqual(["2026-05-20 09", "2026-05-20 10"])
  expect(rows.map((row) => row.tokens)).toEqual([15, 30])
})
```

- [ ] **Step 2: Run test and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: FAIL because `getTime({ preset: "today" })` currently uses the daily aggregate table.

- [ ] **Step 3: Route today time reports to hourly aggregates**

Change the beginning of `getTime` in `desktop/electron/services/usage-analysis/cc-service.ts`:

```ts
const usesHourlyBuckets = range.preset === "today" || range.preset === "7d"
const bucketColumn = usesHourlyBuckets ? "hour" : "date"
const tableName = usesHourlyBuckets ? `${this.prefix}_hourly_usage` : `${this.prefix}_daily_usage`
```

- [ ] **Step 4: Run report tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: PASS.

## Task 3: Add Today View Navigation And Range Visibility

**Files:**
- Modify: `desktop/src/modules/usage-analysis/shared/types.ts`
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx`

- [ ] **Step 1: Add failing shell tests**

Append tests to `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`:

```tsx
it("renders today as the first analysis view", () => {
  const html = renderToStaticMarkup(
    <UsageAnalysisShell
      title="CC"
      view="today"
      range="30d"
      refreshing={false}
      onViewChange={() => undefined}
      onRangeChange={() => undefined}
      onRefresh={() => undefined}
    >
      <div>content</div>
    </UsageAnalysisShell>,
  )

  expect(html.indexOf("今日")).toBeLessThan(html.indexOf("概览"))
})

it("hides the historical range picker on today view", () => {
  const html = renderToStaticMarkup(
    <UsageAnalysisShell
      title="CC"
      view="today"
      range="30d"
      refreshing={false}
      onViewChange={() => undefined}
      onRangeChange={() => undefined}
      onRefresh={() => undefined}
    >
      <div>content</div>
    </UsageAnalysisShell>,
  )

  expect(html).not.toContain("7 天")
  expect(html).not.toContain("90 天")
})

it("shows the historical range picker outside today view", () => {
  const html = renderToStaticMarkup(
    <UsageAnalysisShell
      title="CC"
      view="overview"
      range="30d"
      refreshing={false}
      onViewChange={() => undefined}
      onRangeChange={() => undefined}
      onRefresh={() => undefined}
    >
      <div>content</div>
    </UsageAnalysisShell>,
  )

  expect(html).toContain("7 天")
  expect(html).toContain("90 天")
})
```

- [ ] **Step 2: Keep range picker historical**

Update `desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx`:

```tsx
expect(html).not.toContain("今日")
```

- [ ] **Step 3: Run tests and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/modules/usage-analysis/__tests__/range-picker.test.tsx
```

Expected: FAIL because `today` is not a valid `UsageViewId` and the shell does not hide the range picker.

- [ ] **Step 4: Add today view type**

Change `desktop/src/modules/usage-analysis/shared/types.ts`:

```ts
export type UsageViewId = "today" | "overview" | "time" | "models" | "projects" | "tools"
```

- [ ] **Step 5: Add today tab and hide range picker**

Change `VIEWS` in `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`:

```ts
const VIEWS: { readonly id: UsageViewId; readonly label: string }[] = [
  { id: "today", label: "今日" },
  { id: "overview", label: "概览" },
  { id: "time", label: "时间" },
  { id: "models", label: "模型" },
  { id: "projects", label: "项目" },
  { id: "tools", label: "工具" },
]
```

Change the toolbar:

```tsx
<div className="flex items-center gap-2">
  {props.view === "today" ? null : <RangePicker value={props.range} onChange={props.onRangeChange} />}
  <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={props.refreshing}
    aria-busy={props.refreshing}
    onClick={props.onRefresh}
  >
    <RefreshCw data-icon="inline-start" className={props.refreshing ? "animate-spin" : undefined} />
    {props.refreshing ? "刷新中" : "刷新"}
  </Button>
</div>
```

- [ ] **Step 6: Run shell tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/modules/usage-analysis/__tests__/range-picker.test.tsx
```

Expected: PASS.

## Task 4: Build Today Data Helpers

**Files:**
- Create: `desktop/src/modules/usage-analysis/shared/today.ts`
- Create: `desktop/src/modules/usage-analysis/__tests__/today.test.ts`

- [ ] **Step 1: Add failing helper tests**

Create `desktop/src/modules/usage-analysis/__tests__/today.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  buildTodayModelStructureRows,
  buildTodayMetricRows,
  describeDominantTokenComponent,
  getRecentHourBucket,
} from "../shared/today"
import type { UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "../shared/types"

const overview: UsageOverviewReport = {
  generatedAt: "2026-05-20T04:00:00.000Z",
  totals: {
    tokens: 1200,
    estimatedCost: 1.2,
    requests: 12,
    conversations: 3,
    toolCalls: 0,
    activeDays: 1,
  },
  tokenBreakdown: {
    input: 300,
    output: 200,
    cacheRead: 600,
    cacheWrite: 100,
    reasoning: 0,
  },
  costBreakdown: {
    input: 0.2,
    output: 0.3,
    cacheRead: 0.1,
    cacheWrite: 0.6,
    reasoning: 0,
  },
  topModels: [],
  topProjects: [],
  topTools: [],
  trend: [],
}

const timeRows: UsageTimeBucket[] = [
  {
    bucket: "2026-05-20 09",
    tokens: 400,
    estimatedCost: 0.4,
    requests: 4,
    conversations: 1,
    toolCalls: 0,
    dominantModel: "claude-opus-4.6",
    modelBreakdown: [{
      model: "claude-opus-4.6",
      tokens: 400,
      input: 100,
      output: 100,
      cacheRead: 200,
      cacheWrite: 0,
      reasoning: 0,
    }],
  },
]

describe("today usage helpers", () => {
  it("builds today status metrics", () => {
    vi.setSystemTime(new Date(2026, 4, 20, 12, 0, 0))
    const metrics = buildTodayMetricRows(overview, timeRows, new Date())
    expect(metrics.map((metric) => metric.label)).toEqual(["今日 Token", "今日费用", "最近 1 小时", "今日预计"])
    expect(metrics[2].subValue).toBe("4 请求")
    expect(metrics[3].value).not.toBe("-")
    vi.useRealTimers()
  })

  it("describes the dominant token component", () => {
    expect(describeDominantTokenComponent({
      input: 100,
      output: 50,
      cacheRead: 350,
      cacheWrite: 0,
      reasoning: 0,
    })).toBe("缓存读 70%")
  })

  it("returns the last hourly bucket as recent hour", () => {
    expect(getRecentHourBucket(timeRows)?.bucket).toBe("2026-05-20 09")
  })

  it("limits model structure and groups the remainder", () => {
    const rows = buildTodayModelStructureRows([
      modelRow("a", 100),
      modelRow("b", 90),
      modelRow("c", 80),
      modelRow("d", 70),
      modelRow("e", 60),
      modelRow("f", 50),
    ])
    expect(rows.map((row) => row.label)).toEqual(["a", "b", "c", "d", "e", "其他"])
  })
})

function modelRow(model: string, tokens: number): UsageModelRow {
  return {
    model,
    provider: "",
    tokens,
    estimatedCost: 0,
    input: tokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    requests: 1,
    averageTokensPerRequest: tokens,
  }
}
```

- [ ] **Step 2: Run helper tests and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/today.test.ts
```

Expected: FAIL because `shared/today.ts` does not exist.

- [ ] **Step 3: Implement today helpers**

Create `desktop/src/modules/usage-analysis/shared/today.ts`:

```ts
import type { UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "./types"

interface TodayMetricRow {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

interface BreakdownRow {
  readonly label: string
  readonly value: number
}

interface TokenBreakdownLike {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

const TOKEN_COMPONENTS: { readonly key: keyof TokenBreakdownLike; readonly label: string }[] = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读" },
  { key: "cacheWrite", label: "缓存写" },
  { key: "reasoning", label: "推理" },
]

const MAX_MODEL_STRUCTURE_ROWS = 5

export function buildTodayMetricRows(
  overview: UsageOverviewReport,
  timeRows: readonly UsageTimeBucket[],
  now = new Date(),
): TodayMetricRow[] {
  const recentHour = getRecentHourBucket(timeRows)
  return [
    { label: "今日 Token", value: formatInteger(overview.totals.tokens) },
    { label: "今日费用", value: formatCurrency(overview.totals.estimatedCost) },
    {
      label: "最近 1 小时",
      value: recentHour ? formatInteger(recentHour.tokens) : "-",
      subValue: recentHour ? `${formatInteger(recentHour.requests)} 请求` : undefined,
    },
    {
      label: "今日预计",
      value: formatInteger(projectFullDayValue(overview.totals.tokens, now)),
      subValue: formatCurrency(projectFullDayValue(overview.totals.estimatedCost, now)),
    },
  ]
}

export function getRecentHourBucket(rows: readonly UsageTimeBucket[]): UsageTimeBucket | null {
  return [...rows].filter((row) => row.tokens > 0 || row.requests > 0 || row.toolCalls > 0).at(-1) ?? null
}

export function buildTodayTokenStructureRows(breakdown: TokenBreakdownLike): BreakdownRow[] {
  return TOKEN_COMPONENTS.map((component) => ({
    label: component.label,
    value: breakdown[component.key],
  }))
}

export function buildTodayModelStructureRows(rows: readonly UsageModelRow[]): BreakdownRow[] {
  const sorted = [...rows].filter((row) => row.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const visible = sorted.slice(0, MAX_MODEL_STRUCTURE_ROWS).map((row) => ({ label: row.model, value: row.tokens }))
  const remainder = sorted.slice(MAX_MODEL_STRUCTURE_ROWS).reduce((sum, row) => sum + row.tokens, 0)
  return remainder > 0 ? [...visible, { label: "其他", value: remainder }] : visible
}

export function describeDominantTokenComponent(breakdown: TokenBreakdownLike): string {
  const total = TOKEN_COMPONENTS.reduce((sum, component) => sum + breakdown[component.key], 0)
  if (total <= 0) return "-"
  const dominant = TOKEN_COMPONENTS
    .map((component) => ({ label: component.label, value: breakdown[component.key] }))
    .sort((a, b) => b.value - a.value)[0]
  return `${dominant.label} ${formatPercent(dominant.value / total)}`
}

export function formatTodayHour(bucket: string): string {
  return bucket.length >= 13 ? `${bucket.slice(11, 13)}:00` : bucket
}

function projectFullDayValue(value: number, now: Date): number {
  if (value <= 0) return 0
  const elapsedMs = now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (elapsedMs <= 15 * 60 * 1000) return 0
  return value / Math.min(1, elapsedMs / dayMs)
}

function formatInteger(value: number): string {
  if (value <= 0) return "-"
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatCurrency(value: number): string {
  if (value <= 0) return "-"
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 0 }).format(value)
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/today.test.ts
```

Expected: PASS.

## Task 5: Add Today Chart And Today Report View

**Files:**
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-charts.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`
- Create: `desktop/src/modules/usage-analysis/__tests__/today-report-view.test.tsx`

- [ ] **Step 1: Add failing render test**

Create `desktop/src/modules/usage-analysis/__tests__/today-report-view.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TodayReportView } from "../shared/components/today-report-view"
import type { ReportState, UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "../shared/types"

describe("TodayReportView", () => {
  it("renders today-specific dashboard sections", () => {
    const html = renderToStaticMarkup(
      <TodayReportView
        overviewState={state(overview)}
        timeState={state(timeRows)}
        modelsState={state(models)}
      />,
    )

    expect(html).toContain("今日 Token")
    expect(html).toContain("最近 1 小时")
    expect(html).toContain("今日时段")
    expect(html).toContain("Token 结构")
    expect(html).toContain("模型结构")
    expect(html).toContain("今日节奏")
    expect(html).not.toContain("工具调用排行")
    expect(html).not.toContain("项目 Token 排行")
  })
})

function state<T>(data: T): ReportState<T> {
  return {
    data,
    loading: false,
    error: null,
    reload: async () => undefined,
  }
}

const overview: UsageOverviewReport = {
  generatedAt: "2026-05-20T04:00:00.000Z",
  totals: {
    tokens: 1200,
    estimatedCost: 1.2,
    requests: 12,
    conversations: 3,
    toolCalls: 0,
    activeDays: 1,
  },
  tokenBreakdown: {
    input: 300,
    output: 200,
    cacheRead: 600,
    cacheWrite: 100,
    reasoning: 0,
  },
  costBreakdown: {
    input: 0.2,
    output: 0.3,
    cacheRead: 0.1,
    cacheWrite: 0.6,
    reasoning: 0,
  },
  topModels: [],
  topProjects: [],
  topTools: [],
  trend: [],
}

const timeRows: UsageTimeBucket[] = [{
  bucket: "2026-05-20 09",
  tokens: 1200,
  estimatedCost: 1.2,
  requests: 12,
  conversations: 3,
  toolCalls: 0,
  dominantModel: "claude-opus-4.6",
  modelBreakdown: [{
    model: "claude-opus-4.6",
    tokens: 1200,
    input: 300,
    output: 200,
    cacheRead: 600,
    cacheWrite: 100,
    reasoning: 0,
  }],
}]

const models: UsageModelRow[] = [{
  model: "claude-opus-4.6",
  provider: "",
  tokens: 1200,
  estimatedCost: 1.2,
  input: 300,
  output: 200,
  cacheRead: 600,
  cacheWrite: 100,
  reasoning: 0,
  requests: 12,
  averageTokensPerRequest: 100,
}]
```

- [ ] **Step 2: Run render test and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/today-report-view.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add today composition chart**

Append this export to `desktop/src/modules/usage-analysis/shared/components/usage-charts.tsx`.

Use existing `ChartCard`, existing theme, and no new CSS file:

```tsx
export function UsageTodayHourlyChart({ title, rows }: UsageTrendChartProps) {
  const theme = useUsageEChartsTheme()
  const data = useMemo(() => rows.filter((row) => row.tokens > 0 || row.requests > 0), [rows])
  const option = useMemo<EChartsOption>(() => ({
    color: theme.chart,
    animation: false,
    grid: { top: 24, right: 48, bottom: 28, left: 56 },
    legend: {
      type: "scroll",
      top: 0,
      right: 0,
      textStyle: { color: theme.mutedForeground },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.border, width: 1 } },
      appendToBody: true,
      confine: true,
      transitionDuration: 0,
      position: positionTooltipAwayFromPointer,
      formatter: (params: unknown) => formatTodayTooltip(params, data),
    },
    xAxis: {
      type: "category",
      data: data.map((row) => formatTodayHourLabel(row.bucket)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedForeground },
    },
    yAxis: [
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.border } },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
    ],
    series: [
      todaySeries("输入", data.map((row) => sumModelBreakdown(row, "input")), theme.chart[0]),
      todaySeries("输出", data.map((row) => sumModelBreakdown(row, "output")), theme.chart[1]),
      todaySeries("缓存读", data.map((row) => sumModelBreakdown(row, "cacheRead")), theme.chart[2]),
      todaySeries("缓存写", data.map((row) => sumModelBreakdown(row, "cacheWrite")), theme.chart[3]),
      todaySeries("推理", data.map((row) => sumModelBreakdown(row, "reasoning")), theme.chart[4]),
      {
        name: "请求",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 3,
        lineStyle: { width: 1, color: theme.chart[5] ?? theme.primary },
        itemStyle: { color: theme.chart[5] ?? theme.primary, borderWidth: 0 },
        emphasis: { disabled: true },
        data: data.map((row) => row.requests),
      },
    ],
  }), [data, theme])

  return (
    <ChartCard title={title} empty={data.length === 0}>
      <ReactECharts className="h-80 w-full" option={option} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
    </ChartCard>
  )
}
```

Add helper functions near other private helpers in the same file:

```ts
type TokenComponentKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

function todaySeries(name: string, data: readonly number[], color: string) {
  return {
    name,
    type: "bar" as const,
    stack: "tokens",
    data,
    barMaxWidth: 36,
    itemStyle: { color },
    emphasis: { disabled: true },
    blur: { itemStyle: { opacity: 1 } },
  }
}

function sumModelBreakdown(row: TrendPoint, key: TokenComponentKey): number {
  return (row.modelBreakdown ?? []).reduce((sum, model) => sum + model[key], 0)
}

function formatTodayHourLabel(bucket: string): string {
  return bucket.length >= 13 ? `${bucket.slice(11, 13)}:00` : bucket
}

function formatTodayTooltip(params: unknown, rows: readonly TrendPoint[]): string {
  const items = (Array.isArray(params) ? params : [params]).filter(isTooltipObject)
  const title = String(items[0]?.axisValue ?? items[0]?.axisValueLabel ?? "")
  const row = rows.find((item) => formatTodayHourLabel(item.bucket) === title)
  const bars = items
    .filter((item) => item.componentSubType === "bar")
    .map((item) => ({ marker: item.marker ?? "", name: item.seriesName ?? "", value: readTooltipValue(item) }))
    .filter((item) => item.value > 0)
  const total = bars.reduce((sum, item) => sum + item.value, 0)
  return [
    `<div>${title} <span>${formatCompact(total)} Token</span></div>`,
    ...bars.map((item) => `${item.marker}${item.name}: ${formatCompact(item.value)}`),
    ...(row ? [`请求: ${formatCompact(row.requests)}`, `费用: ${formatCurrencyForTooltip(row.estimatedCost)}`] : []),
  ].join("<br/>")
}

function formatCurrencyForTooltip(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
}
```

- [ ] **Step 4: Add today report component**

Create `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MetricGrid } from "./metric-grid"
import { ReportState } from "./report-state"
import { UsageBreakdownChart, UsageTodayHourlyChart } from "./usage-charts"
import {
  buildTodayMetricRows,
  buildTodayModelStructureRows,
  buildTodayTokenStructureRows,
  describeDominantTokenComponent,
  formatTodayHour,
} from "../today"
import type {
  ReportState as LoaderState,
  UsageModelRow,
  UsageOverviewReport,
  UsageTimeBucket,
} from "../types"

interface TodayReportViewProps {
  readonly overviewState: LoaderState<UsageOverviewReport>
  readonly timeState: LoaderState<UsageTimeBucket[]>
  readonly modelsState: LoaderState<UsageModelRow[]>
}

export function TodayReportView({ overviewState, timeState, modelsState }: TodayReportViewProps) {
  const report = overviewState.data
  const timeRows = timeState.data ?? []
  const modelRows = modelsState.data ?? []
  const loading = overviewState.loading || timeState.loading || modelsState.loading
  const error = overviewState.error ?? timeState.error ?? modelsState.error

  return (
    <ReportState loading={loading} error={error} empty={!report || report.totals.tokens === 0}>
      {report ? (
        <div className="flex flex-col gap-4">
          <MetricGrid metrics={buildTodayMetricRows(report, timeRows)} />
          <UsageTodayHourlyChart title="今日时段" rows={timeRows} />
          <div className="grid gap-4 lg:grid-cols-2">
            <UsageBreakdownChart
              title="Token 结构"
              rows={buildTodayTokenStructureRows(report.tokenBreakdown)}
              valueFormatter={formatInteger}
              compact
            />
            <UsageBreakdownChart
              title="模型结构"
              rows={buildTodayModelStructureRows(modelRows)}
              valueFormatter={formatInteger}
              compact
            />
          </div>
          <TodayRhythmTable rows={timeRows} />
        </div>
      ) : null}
    </ReportState>
  )
}

function TodayRhythmTable({ rows }: { readonly rows: readonly UsageTimeBucket[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">今日节奏</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时段</TableHead>
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead className="text-right">请求</TableHead>
            <TableHead>主要模型</TableHead>
            <TableHead>结构</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.bucket}>
              <TableCell>{formatTodayHour(row.bucket)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(row.estimatedCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
              <TableCell>{row.dominantModel || "-"}</TableCell>
              <TableCell>{describeDominantTokenComponent(sumRowBreakdown(row))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function sumRowBreakdown(row: UsageTimeBucket) {
  return row.modelBreakdown.reduce((sum, model) => ({
    input: sum.input + model.input,
    output: sum.output + model.output,
    cacheRead: sum.cacheRead + model.cacheRead,
    cacheWrite: sum.cacheWrite + model.cacheWrite,
    reasoning: sum.reasoning + model.reasoning,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
}
```

- [ ] **Step 5: Run today view tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/today-report-view.test.tsx
```

Expected: PASS.

## Task 6: Wire Today Into CC And Codex Pages

**Files:**
- Modify: `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx`

- [ ] **Step 1: Add failing page tests**

Update `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`:

```tsx
expect(html).toContain("今日")
expect(html).toContain("刷新")
expect(html).not.toContain("7 天")
```

Update `desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx`:

```tsx
expect(html).toContain("今日")
expect(html).toContain("刷新")
expect(html).not.toContain("7 天")
```

- [ ] **Step 2: Run page tests and verify red**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/cc-page.test.tsx src/modules/usage-analysis/__tests__/codex-page.test.tsx
```

Expected: FAIL because pages default to `overview` and still show the range picker.

- [ ] **Step 3: Wire CC today view**

Change `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`:

```tsx
import { TodayReportView } from "../shared/components/today-report-view"
```

Change initial view:

```tsx
const [view, setView] = useState<UsageViewId>("today")
```

Add shared today states before return:

```tsx
const todayOverviewState = useCcOverview("today", refreshKey)
const todayTimeState = useCcTime("today", refreshKey)
const todayModelsState = useCcModels("today", refreshKey)
```

Add renderer branch before overview:

```tsx
{view === "today" ? (
  <TodayReportView
    overviewState={todayOverviewState}
    timeState={todayTimeState}
    modelsState={todayModelsState}
  />
) : null}
```

Keep existing branches unchanged:

```tsx
{view === "overview" ? <CcOverviewPage range={range} refreshKey={refreshKey} /> : null}
```

- [ ] **Step 4: Wire Codex today view**

Apply the same shape to `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`, using:

```tsx
const todayOverviewState = useCodexOverview("today", refreshKey)
const todayTimeState = useCodexTime("today", refreshKey)
const todayModelsState = useCodexModels("today", refreshKey)
```

and the same `TodayReportView`.

- [ ] **Step 5: Run page tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/cc-page.test.tsx src/modules/usage-analysis/__tests__/codex-page.test.tsx
```

Expected: PASS.

## Task 7: Typecheck And Focused Verification

**Files:**
- No additional source files.

- [ ] **Step 1: Run all targeted usage-analysis tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/usage-analysis/__tests__/range.test.ts \
  electron/services/usage-analysis/__tests__/reports.test.ts \
  electron/usage-analysis/__tests__/ipc-handlers.test.ts \
  src/modules/usage-analysis/__tests__/range-picker.test.tsx \
  src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx \
  src/modules/usage-analysis/__tests__/today.test.ts \
  src/modules/usage-analysis/__tests__/today-report-view.test.tsx \
  src/modules/usage-analysis/__tests__/cc-page.test.tsx \
  src/modules/usage-analysis/__tests__/codex-page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

Do not start the dev server, Playwright, Browser, Chrome, or runtime preview unless the user explicitly asks.
