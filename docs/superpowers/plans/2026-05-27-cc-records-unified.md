# CC Unified Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate CC `明细` and `对话` tabs with one productized `记录` tab that shows session summaries, inline request details, and raw conversation actions.

**Architecture:** Keep the current usage database as the indexed source for session and request summaries. Reuse the existing raw conversation detail window for full transcript reading, but move renderer navigation and naming to records-centered UI. Add one narrow session-detail query so expanding a record row does not scan raw JSONL.

**Tech Stack:** Electron main process, TypeScript, React, shadcn/ui + Radix primitives, Tailwind token classes, Vitest, existing `window.synapse` preload bridge.

---

## File Structure

Modify:

- `desktop/src/types/usage-analysis-conversations.ts`: add record-oriented input/result aliases and session detail input type.
- `desktop/src/types/bridge.ts`: expose `listRecords`, `listRecordDetails`, and keep raw conversation methods.
- `desktop/electron/usage-analysis/channels.ts`: add records IPC channels.
- `desktop/electron/generated/ipc-channels.generated.ts`: generated channel map updated by `pnpm --filter @synapse/desktop run generate:ipc`.
- `desktop/electron/preload.ts`: expose records methods under `window.synapse.usageAnalysis.cc`.
- `desktop/electron/usage-analysis/ipc-handlers.ts`: route records list and details requests.
- `desktop/electron/services/usage-analysis/cc-conversation-service.ts`: add request count to list rows and add session usage detail query.
- `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`: cover session detail query.
- `desktop/src/modules/usage-analysis/shared/types.ts`: rename CC-visible terminal tab from `conversations/details` to `records`.
- `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`: show `记录` for CC and remove `明细` / `对话`.
- `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`: render `CcRecordsPage`; stop rendering `CcDetailsPage` and `CcConversationsPage`.
- `desktop/src/modules/usage-analysis/cc/hooks.ts`: add records list and record detail hooks.
- `desktop/src/modules/usage-analysis/cc/pages/conversations.tsx`: replace with or migrate to `records.tsx`.
- `desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx`: migrate to record table with expandable detail rows.
- `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`: update CC tab expectations.
- `desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx`: migrate to records page tests.
- `desktop/src/modules/usage-analysis/__tests__/conversation-table.test.tsx`: migrate to record table tests.
- `RELEASE_NOTES_PENDING.md`: add a user-facing note for the merged `记录` workflow.

Create:

- `desktop/src/modules/usage-analysis/cc/pages/records.tsx`: records page component.
- `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`: expandable session summary table.
- `desktop/src/modules/usage-analysis/cc/components/record-detail-rows.tsx`: request detail rows under an expanded session.
- `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`: records page tests.
- `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`: record table tests.

Preferred path is to create the new `records` files, keep the old `conversation-*` raw-detail components, then remove obsolete `pages/details.tsx`, `pages/conversations.tsx`, and old conversation table files only after tests are green.

## Task 1: Records Types, Bridge, And IPC Surface

**Files:**

- Modify: `desktop/src/types/usage-analysis-conversations.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/usage-analysis/channels.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Generate: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`
- Test: `desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts`

- [ ] **Step 1: Add failing preload expectations**

In `desktop/electron/__tests__/preload.test.ts`, extend the existing usage-analysis bridge assertions so CC exposes records methods:

```ts
expect(Object.keys(bridge.usageAnalysis.cc)).toEqual(expect.arrayContaining([
  "listRecords",
  "listRecordDetails",
  "getConversation",
  "searchRecordsText",
  "searchConversationText",
  "openConversationWindow",
]))
```

Also assert the generated channels include:

```ts
expect(ipcRendererInvokeMock).toHaveBeenCalledWith(
  "synapse:usage-analysis:cc:records:list",
  expect.anything(),
)
expect(ipcRendererInvokeMock).toHaveBeenCalledWith(
  "synapse:usage-analysis:cc:record-details:list",
  expect.anything(),
)
expect(ipcRendererInvokeMock).toHaveBeenCalledWith(
  "synapse:usage-analysis:cc:records:search-text",
  expect.anything(),
)
```

- [ ] **Step 2: Run preload test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
```

Expected: FAIL because `listRecords`, `listRecordDetails`, and `searchRecordsText` are not exposed.

- [ ] **Step 3: Add shared record types**

In `desktop/src/types/usage-analysis-conversations.ts`, append these types without removing raw conversation types:

```ts
export type CcRecordListInput = CcConversationListInput

export type CcRecordListItem = CcConversationListItem & {
  readonly requestCount: number
}

export type CcRecordDetailRow = {
  readonly id: string
  readonly usageEventId?: string
  readonly timestamp: string
  readonly timestampMs?: number
  readonly sessionId: string
  readonly workspaceLabel: string
  readonly model: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly tokenBreakdown: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly reasoning: number
  }
  readonly toolCalls: number
  readonly durationMs?: number
}

export type CcRecordListResult = {
  readonly items: readonly CcRecordListItem[]
  readonly total: number
  readonly nextCursor?: string
  readonly partial: boolean
}

export type CcRecordDetailsInput = {
  readonly sessionId: string
  readonly limit?: number
  readonly offset?: number
}

export type CcRecordDetailsResult = {
  readonly sessionId: string
  readonly rows: readonly CcRecordDetailRow[]
  readonly total: number
}
```

- [ ] **Step 4: Update bridge types**

In `desktop/src/types/bridge.ts`, import the new record types and extend `ClaudeCodeUsageAnalysisBridgeDomain`:

```ts
import type {
  CcConversationDetail,
  CcConversationFocus,
  CcConversationListInput,
  CcConversationListResult,
  CcConversationWindowRequest,
  CcRecordDetailsInput,
  CcRecordDetailsResult,
  CcRecordListInput,
  CcRecordListResult,
} from "./usage-analysis-conversations"

export type ClaudeCodeUsageAnalysisBridgeDomain = UsageAnalysisBridgeDomain & {
  listRecords: (input: CcRecordListInput) => Promise<CcRecordListResult>
  listRecordDetails: (input: CcRecordDetailsInput) => Promise<CcRecordDetailsResult>
  listConversations: (input: CcConversationListInput) => Promise<CcConversationListResult>
  getConversation: (sessionId: string, focus?: CcConversationFocus) => Promise<CcConversationDetail>
  searchRecordsText: (input: CcRecordListInput) => Promise<CcRecordListResult>
  searchConversationText: (input: CcConversationListInput) => Promise<CcConversationListResult>
  openConversationWindow: (request: CcConversationWindowRequest) => Promise<void>
}
```

- [ ] **Step 5: Add IPC channels**

In `desktop/electron/usage-analysis/channels.ts`, add:

```ts
ccRecordsList: "synapse:usage-analysis:cc:records:list",
ccRecordDetailsList: "synapse:usage-analysis:cc:record-details:list",
ccRecordsSearchText: "synapse:usage-analysis:cc:records:search-text",
```

In `desktop/electron/preload.ts`, add the same keys under `IPC_CHANNELS["usage-analysis"]` and expose:

```ts
listRecords: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordsList)(input),
listRecordDetails: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordDetailsList)(input),
searchRecordsText: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordsSearchText)(input),
```

- [ ] **Step 6: Register IPC handlers**

In `desktop/electron/usage-analysis/ipc-handlers.ts`, route the new handlers to the CC conversation service:

```ts
registry.handle(USAGE_ANALYSIS_CHANNELS.ccRecordsList, async (_event, input) => {
  return ccConversationService.listRecords(input as CcRecordListInput)
})

registry.handle(USAGE_ANALYSIS_CHANNELS.ccRecordDetailsList, async (_event, input) => {
  return ccConversationService.listRecordDetails(input as CcRecordDetailsInput)
})

registry.handle(USAGE_ANALYSIS_CHANNELS.ccRecordsSearchText, async (_event, input) => {
  return ccConversationService.searchRecordsText(input as CcRecordListInput)
})
```

Use the same registry helper style already used in this file. Do not add direct `ipcMain.handle`.

- [ ] **Step 7: Generate IPC channel map**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes the three records channels.

- [ ] **Step 8: Run IPC/preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts electron/usage-analysis/__tests__/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/types/usage-analysis-conversations.ts desktop/src/types/bridge.ts desktop/electron/usage-analysis/channels.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/preload.ts desktop/electron/usage-analysis/ipc-handlers.ts desktop/electron/__tests__/preload.test.ts desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts
git commit -m "feat: expose cc records ipc"
```

## Task 2: Main-Process Record List And Session Detail Query

**Files:**

- Modify: `desktop/electron/services/usage-analysis/cc-conversation-service.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`

- [ ] **Step 1: Add failing service tests**

In `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`, add tests using the existing `setupFixture()` fixture:

```ts
it("returns record rows with request counts", () => {
  const { db } = setupFixture()
  const service = new CcConversationService({ db })
  insertUsage(db, {
    id: "usage-2",
    sessionId: "session-1",
    timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
    input: 20,
    output: 5,
  })

  expect(service.listRecords({ preset: "all", limit: 20 }).items[0]).toEqual(expect.objectContaining({
    sessionId: "session-1",
    requestCount: 2,
    tokens: 40,
  }))
})

it("lists request details for one session only", () => {
  const { db } = setupFixture()
  const service = new CcConversationService({ db })
  insertSession(db, { sessionId: "session-2", filePath: "/tmp/session-2.jsonl", workspaceLabel: "/repo" })
  insertUsage(db, {
    id: "usage-2",
    sessionId: "session-2",
    timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
    input: 20,
    output: 5,
  })

  expect(service.listRecordDetails({ sessionId: "session-1" })).toEqual({
    sessionId: "session-1",
    total: 1,
    rows: [expect.objectContaining({
      id: "usage-1",
      sessionId: "session-1",
      tokens: 15,
      timestampMs: Date.parse("2026-05-27T01:00:01.000Z"),
    })],
  })
})

it("searches raw record text with request counts", async () => {
  const { db } = setupFixture()
  const service = new CcConversationService({ db })

  const result = await service.searchRecordsText({ preset: "all", query: "登录", rawText: true })

  expect(result.items[0]).toEqual(expect.objectContaining({
    sessionId: "session-1",
    requestCount: 1,
  }))
})
```

Add these helpers below `setupFixture()`:

```ts
function insertSession(db: DatabaseSync, input: { sessionId: string; filePath: string; workspaceLabel: string }): void {
  db.prepare(`
    INSERT INTO cc_sessions (
      session_id, file_path, workspace_key, workspace_label, started_at, ended_at, model_summary, tool_call_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId,
    input.filePath,
    input.workspaceLabel.replaceAll("/", "-"),
    input.workspaceLabel,
    "2026-05-27T01:00:00.000Z",
    "2026-05-27T01:10:00.000Z",
    "claude-opus-4.6",
    0,
  )
}

function insertUsage(
  db: DatabaseSync,
  input: { id: string; sessionId: string; timestampMs: number; input: number; output: number },
): void {
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 1)
  `).run(
    input.id,
    input.sessionId,
    input.timestampMs,
    "2026-05-27",
    "2026-05-27 09",
    "-repo",
    "/repo",
    "claude-opus-4.6",
    "anthropic",
    input.input,
    input.output,
    input.input + input.output,
  )
}
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
```

Expected: FAIL because `listRecords`, `listRecordDetails`, and `searchRecordsText` do not exist or do not include `requestCount`.

- [ ] **Step 3: Add record methods**

In `desktop/electron/services/usage-analysis/cc-conversation-service.ts`, import record types and add methods:

```ts
import type {
  CcRecordDetailsInput,
  CcRecordDetailRow,
  CcRecordDetailsResult,
  CcRecordListInput,
  CcRecordListResult,
} from "../../../src/types/usage-analysis-conversations"
```

Add to `CcConversationService`:

```ts
listRecords(input: CcRecordListInput): CcRecordListResult {
  const conversations = this.listConversations(input)
  return {
    ...conversations,
    items: conversations.items.map((item) => ({
      ...item,
      requestCount: this.countUsageEvents(item.sessionId),
    })),
  }
}

async searchRecordsText(input: CcRecordListInput): Promise<CcRecordListResult> {
  const conversations = await this.searchConversationText(input)
  return {
    ...conversations,
    items: conversations.items.map((item) => ({
      ...item,
      requestCount: this.countUsageEvents(item.sessionId),
    })),
  }
}

listRecordDetails(input: CcRecordDetailsInput): CcRecordDetailsResult {
  const sessionId = input.sessionId.trim()
  if (!sessionId) return { sessionId, rows: [], total: 0 }

  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  const count = this.db.prepare(`
    SELECT COUNT(*) AS total
    FROM cc_usage_events
    WHERE session_id = ?
  `).get(sessionId) as { total?: number } | undefined
  const rows = this.db.prepare(`
    SELECT u.*, COALESCE(t.tool_calls, 0) AS tool_calls
    FROM cc_usage_events u
    LEFT JOIN (
      SELECT session_id, COUNT(*) AS tool_calls
      FROM cc_tool_events
      WHERE session_id = ?
      GROUP BY session_id
    ) t ON t.session_id = u.session_id
    WHERE u.session_id = ?
    ORDER BY u.timestamp_ms DESC
    LIMIT ? OFFSET ?
  `).all(sessionId, sessionId, limit, offset) as Record<string, unknown>[]

  return {
    sessionId,
    rows: rows.map(toRecordDetailRow),
    total: toNumber(count?.total),
  }
}
```

Add private helper:

```ts
private countUsageEvents(sessionId: string): number {
  const row = this.db.prepare(`
    SELECT COUNT(*) AS total
    FROM cc_usage_events
    WHERE session_id = ?
  `).get(sessionId) as { total?: number } | undefined
  return toNumber(row?.total)
}
```

Add module-level helpers:

```ts
function isoFromTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function usageTokenTotal(row: Record<string, unknown>): number {
  return toNumber(row.input_tokens)
    + toNumber(row.output_tokens)
    + toNumber(row.cache_read_tokens)
    + toNumber(row.cache_write_tokens)
    + toNumber(row.reasoning_tokens)
}

function toRecordDetailRow(row: Record<string, unknown>): CcRecordDetailRow {
  const tokens = usageTokenTotal(row)
  return {
    id: String(row.id ?? ""),
    usageEventId: String(row.id ?? ""),
    timestamp: isoFromTimestamp(toNumber(row.timestamp_ms)),
    timestampMs: toNumber(row.timestamp_ms),
    sessionId: String(row.session_id ?? ""),
    workspaceLabel: String(row.workspace_label || row.workspace_key || "unknown"),
    model: String(row.model || "unknown"),
    tokens,
    pricedTokens: toNumber(row.priced_tokens),
    unpricedTokens: toNumber(row.unpriced_tokens),
    estimatedCost: toNumber(row.total_cost),
    tokenBreakdown: {
      input: toNumber(row.input_tokens),
      output: toNumber(row.output_tokens),
      cacheRead: toNumber(row.cache_read_tokens),
      cacheWrite: toNumber(row.cache_write_tokens),
      reasoning: toNumber(row.reasoning_tokens),
    },
    toolCalls: toNumber(row.tool_calls),
  }
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-conversation-service.ts desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
git commit -m "feat: add cc records service"
```

## Task 3: Shell Navigation And CC Page Routing

**Files:**

- Modify: `desktop/src/modules/usage-analysis/shared/types.ts`
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/hooks.ts`
- Create: `desktop/src/modules/usage-analysis/cc/pages/records.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`

- [ ] **Step 1: Write failing shell test**

In `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`, replace the CC details/conversations assertion with:

```ts
it("shows records tab for CC analysis without separate details and conversation tabs", () => {
  const html = renderToStaticMarkup(
    <UsageAnalysisShell
      title="CC"
      view="records"
      views={CC_USAGE_VIEWS}
      range="30d"
      refreshing={false}
      onViewChange={() => undefined}
      onRangeChange={() => undefined}
      onRefresh={() => undefined}
    >
      <div>content</div>
    </UsageAnalysisShell>,
  )

  expect(html).toContain("记录")
  expect(html).not.toContain("明细")
  expect(html).not.toContain("对话")
})
```

- [ ] **Step 2: Write failing records page smoke test**

Create `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcRecordsPage } from "../cc/pages/records"
import type { CcRecordListResult } from "@/types/usage-analysis-conversations"
import type { ReportState } from "../shared/types"

const recordData: CcRecordListResult = {
  total: 128,
  partial: false,
  items: [{
    sessionId: "s1",
    title: "修登录问题",
    workspaceKey: "-repo",
    workspaceLabel: "/repo",
    startedAt: "2026-05-27T01:00:00.000Z",
    endedAt: "2026-05-27T01:00:01.000Z",
    modelSummary: "claude-opus-4.6",
    tokens: 15,
    estimatedCost: 0.01,
    toolCalls: 1,
    eventCount: 3,
    attachmentCount: 0,
    requestCount: 2,
    lastUsedAt: "2026-05-27T01:00:01.000Z",
    sourceFilePath: "/tmp/session-1.jsonl",
  }],
}

let recordsState: ReportState<CcRecordListResult> = {
  data: recordData,
  loading: false,
  error: null,
  reload: async () => undefined,
}

vi.mock("../cc/hooks", () => ({
  useCcRecords: () => recordsState,
}))

describe("CcRecordsPage", () => {
  beforeEach(() => {
    recordsState = {
      data: recordData,
      loading: false,
      error: null,
      reload: async () => undefined,
    }
  })

  it("renders record filters and session summary actions", () => {
    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("请求")
    expect(html).toContain("打开对话")
    expect(html).toContain("已显示 1 / 128 条记录")
    expect(html).toContain("加载更多")
  })

  it("shows a visible loading status while records load", () => {
    recordsState = { ...recordsState, data: null, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在读取记录")
  })
})
```

- [ ] **Step 3: Run shell and page tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
```

Expected: FAIL because `records` view and `CcRecordsPage` do not exist.

- [ ] **Step 4: Update usage view type and shell tabs**

In `desktop/src/modules/usage-analysis/shared/types.ts`, change `UsageViewId` to:

```ts
export type UsageViewId = "today" | "overview" | "time" | "models" | "projects" | "tools" | "records"
```

In `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`, update `CC_USAGE_VIEWS`:

```ts
const CC_USAGE_VIEWS: readonly UsageViewOption[] = [
  ...BASE_USAGE_VIEWS,
  { id: "records", label: "记录" },
]
```

- [ ] **Step 5: Add record list hook**

In `desktop/src/modules/usage-analysis/cc/hooks.ts`, change the conversation type import to:

```ts
import type {
  CcConversationListInput,
  CcRecordListInput,
} from "@/types/usage-analysis-conversations"
```

Append:

```ts
export function useCcRecords(input: CcRecordListInput, refreshKey: number) {
  return useReportLoader(
    () => input.rawText
      ? requireSynapseBridge().usageAnalysis.cc.searchRecordsText(input)
      : requireSynapseBridge().usageAnalysis.cc.listRecords(input),
    [
      input.preset,
      input.query,
      input.rawText,
      input.project,
      input.model,
      input.tool,
      input.eventType,
      input.limit,
      input.offset,
      input.cursor,
      refreshKey,
    ],
  )
}
```

- [ ] **Step 6: Add records page**

Create `desktop/src/modules/usage-analysis/cc/pages/records.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { CcRecordListInput } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { RecordTable } from "../components/record-table"
import { useCcRecords } from "../hooks"

export function CcRecordsPage({
  range,
  refreshKey,
}: {
  readonly range: UsageRangePreset
  readonly refreshKey: number
}) {
  const [query, setQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const [loadedLimit, setLoadedLimit] = useState(50)
  useEffect(() => {
    setLoadedLimit(50)
  }, [range])
  const input = useMemo<CcRecordListInput>(() => ({
    preset: range,
    query,
    rawText,
    limit: loadedLimit,
    offset: 0,
  }), [range, query, rawText, loadedLimit])
  const state = useCcRecords(input, refreshKey)
  const rows = state.data?.items ?? []
  const total = state.data?.total ?? 0
  const shown = rows.length
  const canLoadMore = shown > 0 && shown < total

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ConversationFilters
        query={query}
        rawText={rawText}
        onQueryChange={(next) => {
          setQuery(next)
          setLoadedLimit(50)
        }}
        onRawTextChange={(next) => {
          setRawText(next)
          setLoadedLimit(50)
        }}
      />
      {state.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在读取记录
        </div>
      ) : null}
      <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0}>
        <RecordTable
          rows={rows}
          onOpenConversation={(row) => {
            void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
              sessionId: row.sessionId,
              title: row.title,
            })
          }}
        />
        {shown > 0 ? (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
            <span>已显示 {shown} / {total} 条记录</span>
            {canLoadMore ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLoadedLimit((current) => current + 50)}
              >
                加载更多
              </Button>
            ) : null}
          </div>
        ) : null}
      </ReportState>
    </div>
  )
}
```

This uses the current filters component to keep the first pass surgical.

- [ ] **Step 7: Add record table scaffold**

Create `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`:

```tsx
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CcRecordListItem } from "@/types/usage-analysis-conversations"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

export function RecordTable({
  rows,
  onOpenConversation,
}: {
  readonly rows: readonly CcRecordListItem[]
  readonly onOpenConversation: (row: CcRecordListItem) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>项目</TableHead>
          <TableHead className="text-right">请求</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.sessionId}>
            <TableCell>{row.title || row.sessionId}</TableCell>
            <TableCell>{row.workspaceLabel || row.workspaceKey || "-"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInteger(row.requestCount)}</TableCell>
            <TableCell className="text-right">
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                <ExternalLink data-icon="inline-start" />
                打开对话
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 8: Route CC page to records**

In `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`:

```ts
import { CcRecordsPage } from "./pages/records"
```

Remove imports for `CcConversationsPage` and `CcDetailsPage`, then replace the two render branches with:

```tsx
{view === "records" ? <CcRecordsPage range={range} refreshKey={refreshKey} /> : null}
```

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/modules/usage-analysis/shared/types.ts desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx desktop/src/modules/usage-analysis/cc/hooks.ts desktop/src/modules/usage-analysis/cc/pages/records.tsx desktop/src/modules/usage-analysis/cc/components/record-table.tsx desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
git commit -m "feat: merge cc detail and conversation tabs"
```

## Task 4: Expandable Record Table And Inline Request Details

**Files:**

- Modify: `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/record-detail-rows.tsx`
- Create: `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/hooks.ts`

- [ ] **Step 1: Add failing record table tests**

Create `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RecordTable } from "../cc/components/record-table"
import type { CcRecordListItem } from "@/types/usage-analysis-conversations"

describe("RecordTable", () => {
  it("renders session summaries with request counts and raw conversation action", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[record({ requestCount: 2 })]}
        expandedSessionId={null}
        detailRows={[]}
        detailTotal={0}
        detailLoading={false}
        onToggleExpanded={() => undefined}
        onOpenConversation={() => undefined}
        onOpenDetail={() => undefined}
        onLoadMoreDetails={() => undefined}
      />,
    )

    expect(html).toContain("请求")
    expect(html).toContain("2")
    expect(html).toContain("打开对话")
  })

  it("removes shared path prefixes from title and project columns", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[
          record({ sessionId: "s1", title: "a/b/c", workspaceLabel: "/Users/me/work/alpha" }),
          record({ sessionId: "s2", title: "a/b/d", workspaceLabel: "/Users/me/work/beta" }),
        ]}
        expandedSessionId={null}
        detailRows={[]}
        detailTotal={0}
        detailLoading={false}
        onToggleExpanded={() => undefined}
        onOpenConversation={() => undefined}
        onOpenDetail={() => undefined}
        onLoadMoreDetails={() => undefined}
      />,
    )

    expect(html).toMatch(/title="a\/b\/c"[^>]*>c<\/span>/)
    expect(html).toMatch(/title="a\/b\/d"[^>]*>d<\/span>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/alpha"[^>]*>alpha<\/td>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/beta"[^>]*>beta<\/td>/)
  })

  it("renders expanded request details with a focus action", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[record({ sessionId: "s1" })]}
        expandedSessionId="s1"
        detailRows={[{
          id: "u1",
          usageEventId: "u1",
          timestamp: "2026-05-27T01:00:00.000Z",
          timestampMs: 1779843600000,
          sessionId: "s1",
          workspaceLabel: "/repo",
          model: "claude-opus-4.6",
          tokens: 15,
          pricedTokens: 15,
          unpricedTokens: 0,
          estimatedCost: 0.01,
          tokenBreakdown: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          toolCalls: 1,
        }]}
        detailTotal={2}
        detailLoading={false}
        onToggleExpanded={() => undefined}
        onOpenConversation={() => undefined}
        onOpenDetail={() => undefined}
        onLoadMoreDetails={() => undefined}
      />,
    )

    expect(html).toContain("claude-opus-4.6")
    expect(html).toContain("定位到对话")
    expect(html).toContain("已显示 1 / 2")
    expect(html).toContain("加载更多请求")
  })
})

function record(overrides: Partial<CcRecordListItem>): CcRecordListItem {
  return {
    sessionId: "session",
    title: "title",
    workspaceKey: "workspace",
    workspaceLabel: "workspace",
    startedAt: "2026-05-27T01:00:00.000Z",
    endedAt: "2026-05-27T01:00:01.000Z",
    modelSummary: "claude-opus-4.6",
    tokens: 15,
    estimatedCost: 0.01,
    toolCalls: 1,
    eventCount: 3,
    attachmentCount: 0,
    requestCount: 1,
    lastUsedAt: "2026-05-27T01:00:01.000Z",
    sourceFilePath: "/tmp/session.jsonl",
    ...overrides,
  }
}
```

- [ ] **Step 2: Run table tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-table.test.tsx
```

Expected: FAIL because the scaffolded `RecordTable` does not render expanded details or shortened paths yet.

- [ ] **Step 3: Add record detail rows component**

Create `desktop/src/modules/usage-analysis/cc/components/record-detail-rows.tsx`:

```tsx
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import type { CcRecordDetailRow } from "@/types/usage-analysis-conversations"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

export function RecordDetailRows({
  rows,
  total,
  loading,
  onOpenDetail,
  onLoadMore,
}: {
  readonly rows: readonly CcRecordDetailRow[]
  readonly total: number
  readonly loading: boolean
  readonly onOpenDetail: (row: CcRecordDetailRow) => void
  readonly onLoadMore: () => void
}) {
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-muted-foreground">正在读取明细</TableCell>
      </TableRow>
    )
  }

  if (rows.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-muted-foreground">暂无请求明细</TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell>{row.timestamp}</TableCell>
          <TableCell />
          <TableCell />
          <TableCell>{row.model}</TableCell>
          <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
          <TableCell />
          <TableCell className="text-right">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenDetail(row)}>
              <ExternalLink data-icon="inline-start" />
              定位到对话
            </Button>
          </TableCell>
        </TableRow>
      ))}
      {rows.length < total ? (
        <TableRow>
          <TableCell colSpan={9} className="text-right">
            <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
              <span>已显示 {rows.length} / {total}</span>
              <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
                加载更多请求
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
```

- [ ] **Step 4: Replace record table scaffold with expandable table**

Replace `desktop/src/modules/usage-analysis/cc/components/record-table.tsx` with:

```tsx
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import type {
  CcRecordDetailRow,
  CcRecordListItem,
} from "@/types/usage-analysis-conversations"
import { RecordDetailRows } from "./record-detail-rows"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/")
}

function pathParts(value: string): string[] {
  return normalizePath(value).split("/").filter(Boolean)
}

function shortenCommonPathPrefixes(values: readonly string[]): string[] {
  const normalizedValues = values.map(normalizePath)
  if (normalizedValues.length < 2) return normalizedValues

  const partsByValue = normalizedValues.map(pathParts)
  const minLength = Math.min(...partsByValue.map((parts) => parts.length))
  const maxPrefixLength = Math.max(0, minLength - 1)
  let prefixLength = 0

  while (
    prefixLength < maxPrefixLength
    && partsByValue.every((parts) => parts[prefixLength] === partsByValue[0]?.[prefixLength])
  ) {
    prefixLength += 1
  }

  if (prefixLength === 0) return normalizedValues

  return partsByValue.map((parts, index) =>
    parts.slice(prefixLength).join("/") || normalizedValues[index],
  )
}

export function RecordTable({
  rows,
  expandedSessionId,
  detailRows,
  detailTotal,
  detailLoading,
  onToggleExpanded,
  onOpenConversation,
  onOpenDetail,
  onLoadMoreDetails,
}: {
  readonly rows: readonly CcRecordListItem[]
  readonly expandedSessionId: string | null
  readonly detailRows: readonly CcRecordDetailRow[]
  readonly detailTotal: number
  readonly detailLoading: boolean
  readonly onToggleExpanded: (row: CcRecordListItem) => void
  readonly onOpenConversation: (row: CcRecordListItem) => void
  readonly onOpenDetail: (row: CcRecordDetailRow) => void
  readonly onLoadMoreDetails: () => void
}) {
  const titleValues = rows.map((row) => row.title || row.sessionId)
  const projectValues = rows.map((row) => row.workspaceLabel || row.workspaceKey || "-")
  const displayTitles = shortenCommonPathPrefixes(titleValues)
  const displayProjects = shortenCommonPathPrefixes(projectValues)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>项目</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="text-right">Token</TableHead>
          <TableHead className="text-right">费用</TableHead>
          <TableHead className="text-right">工具</TableHead>
          <TableHead className="text-right">请求</TableHead>
          <TableHead className="text-right">事件</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const expanded = row.sessionId === expandedSessionId
          const ExpandIcon = expanded ? ChevronDown : ChevronRight
          return (
            <>
              <TableRow key={row.sessionId}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => onToggleExpanded(row)} aria-label="展开记录">
                      <ExpandIcon />
                    </Button>
                    <span className="font-medium" title={titleValues[index]}>{displayTitles[index]}</span>
                  </div>
                </TableCell>
                <TableCell title={projectValues[index]}>{displayProjects[index]}</TableCell>
                <TableCell>{row.modelSummary || "-"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.requestCount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.eventCount)}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                    <ExternalLink data-icon="inline-start" />
                    打开对话
                  </Button>
                </TableCell>
              </TableRow>
              {expanded ? (
                <RecordDetailRows
                  rows={detailRows}
                  total={detailTotal}
                  loading={detailLoading}
                  onOpenDetail={onOpenDetail}
                  onLoadMore={onLoadMoreDetails}
                />
              ) : null}
            </>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 5: Add record detail hook**

In `desktop/src/modules/usage-analysis/cc/hooks.ts`, add `CcRecordDetailsInput` to the existing conversation/record type import:

```ts
import type {
  CcConversationListInput,
  CcRecordDetailsInput,
  CcRecordListInput,
} from "@/types/usage-analysis-conversations"
```

Append:

```ts
export function useCcRecordDetails(input: CcRecordDetailsInput | null, refreshKey: number) {
  return useReportLoader(
    () => input
      ? requireSynapseBridge().usageAnalysis.cc.listRecordDetails(input)
      : Promise.resolve({ sessionId: "", rows: [], total: 0 }),
    [input?.sessionId, input?.limit, input?.offset, refreshKey],
  )
}
```

- [ ] **Step 6: Wire expansion in records page**

Update `desktop/src/modules/usage-analysis/cc/pages/records.tsx`:

```tsx
const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
const [detailLimit, setDetailLimit] = useState(200)
useEffect(() => {
  setDetailLimit(200)
}, [expandedSessionId])
const detailState = useCcRecordDetails(
  expandedSessionId ? { sessionId: expandedSessionId, limit: detailLimit } : null,
  refreshKey,
)
```

Pass to `RecordTable`:

```tsx
<RecordTable
  rows={rows}
  expandedSessionId={expandedSessionId}
  detailRows={detailState.data?.rows ?? []}
  detailTotal={detailState.data?.total ?? 0}
  detailLoading={detailState.loading && Boolean(expandedSessionId)}
  onToggleExpanded={(row) => {
    setExpandedSessionId((current) => current === row.sessionId ? null : row.sessionId)
  }}
  onOpenConversation={(row) => {
    void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
      sessionId: row.sessionId,
      title: row.title,
    })
  }}
  onOpenDetail={(row) => {
    void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
      sessionId: row.sessionId,
      title: row.workspaceLabel,
      focus: {
        usageEventId: row.usageEventId ?? row.id,
        timestampMs: row.timestampMs,
      },
    })
  }}
  onLoadMoreDetails={() => setDetailLimit((current) => current + 200)}
/>
```

- [ ] **Step 7: Run record table/page tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-table.test.tsx src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/usage-analysis/cc/components/record-table.tsx desktop/src/modules/usage-analysis/cc/components/record-detail-rows.tsx desktop/src/modules/usage-analysis/cc/hooks.ts desktop/src/modules/usage-analysis/cc/pages/records.tsx desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
git commit -m "feat: add expandable cc records table"
```

## Task 5: Remove Obsolete CC Detail/Conversation Entry Points

**Files:**

- Delete: `desktop/src/modules/usage-analysis/cc/pages/details.tsx`
- Delete: `desktop/src/modules/usage-analysis/cc/pages/conversations.tsx`
- Delete or keep only if still imported: `desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx`
- Delete or migrate: `desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx`
- Delete or migrate: `desktop/src/modules/usage-analysis/__tests__/conversation-table.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Search for obsolete imports**

Run:

```bash
rg -n "CcDetailsPage|CcConversationsPage|ConversationTable|view === \"details\"|view === \"conversations\"|明细|对话" desktop/src/modules/usage-analysis
```

Expected after cleanup: no CC navigation references to separate `明细` or `对话`; raw conversation detail window components may still contain `对话` text for the window action/title.

- [ ] **Step 2: Update or remove obsolete tests**

Delete the superseded tests after the replacement records tests pass:

```bash
git rm desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx
git rm desktop/src/modules/usage-analysis/__tests__/conversation-table.test.tsx
```

The path-prefix expectations are already present in `record-table.test.tsx`, so no additional migration is required before deleting.

- [ ] **Step 3: Delete obsolete pages/components**

Run:

```bash
git rm desktop/src/modules/usage-analysis/cc/pages/details.tsx
git rm desktop/src/modules/usage-analysis/cc/pages/conversations.tsx
git rm desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx
```

Do not delete `conversation-detail-window-page.tsx`, `conversation-event-stream.tsx`, or `conversation-event-inspector.tsx`; those are still the raw transcript window.

- [ ] **Step 4: Update release notes**

In `RELEASE_NOTES_PENDING.md`, add one concise line under `功能优化`:

```md
- CC 使用分析将“明细”和“对话”合并为“记录”，可在会话行内展开请求明细并打开原始对话。
```

Keep existing pending notes that describe loading state, path prefix shortening, and preload fixes.

- [ ] **Step 5: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/modules/usage-analysis/__tests__/cc-page.test.tsx src/modules/usage-analysis/__tests__/cc-records-page.test.tsx src/modules/usage-analysis/__tests__/record-table.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run style guard search**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" desktop/src/modules/usage-analysis desktop/electron/services/usage-analysis desktop/electron/usage-analysis desktop/electron/preload.ts
```

Expected: no new violations from this work. Existing global token definitions outside this scope are irrelevant.

- [ ] **Step 7: Commit**

```bash
git add RELEASE_NOTES_PENDING.md desktop/src/modules/usage-analysis
git commit -m "chore: remove separate cc detail conversation tabs"
```

## Task 6: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run all related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts \
  electron/usage-analysis/__tests__/ipc-handlers.test.ts \
  electron/__tests__/preload.test.ts \
  src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx \
  src/modules/usage-analysis/__tests__/cc-page.test.tsx \
  src/modules/usage-analysis/__tests__/cc-records-page.test.tsx \
  src/modules/usage-analysis/__tests__/record-table.test.tsx \
  src/modules/usage-analysis/__tests__/report-views.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Confirm no obsolete CC tabs remain**

Run:

```bash
rg -n "明细|对话|details|conversations" desktop/src/modules/usage-analysis/cc desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx desktop/src/modules/usage-analysis/shared/types.ts
```

Expected: only raw transcript window/action wording may mention `对话`; shell navigation should only expose `记录`.

- [ ] **Step 4: Confirm branch state**

Run:

```bash
git status --short
```

Expected: no uncommitted files from this plan remain. Unrelated pre-existing files may still appear.

## Self-Review

- Spec coverage: The plan covers merged navigation, session-centered rows, inline details, raw transcript actions, loading states, path shortening, main-process detail query, release notes, tests, and typecheck.
- Deferred-work scan: No deferred implementation tasks remain.
- Type consistency: The plan consistently uses `CcRecordListInput`, `CcRecordListResult`, `CcRecordListItem`, `CcRecordDetailsInput`, and `CcRecordDetailsResult`; raw transcript APIs remain named `Conversation` because they still open/read the raw conversation window.
