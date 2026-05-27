# CC Records Infinite Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CC records table alignment/search clarity issues and replace the manual record load-more button with guarded scroll loading.

**Architecture:** Keep the current CC records IPC and renderer-side `limit += 50` loading model. Add a small records loading helper for status text and guard decisions, wire an `IntersectionObserver` sentinel in `CcRecordsPage`, and keep table/filter visual fixes local to existing CC components. Use shadcn/Radix components and Tailwind token classes only.

**Tech Stack:** Electron renderer, React, TypeScript, shadcn/ui + Radix, Tailwind token utilities, Vitest static renderer tests.

---

## File Structure

Modify:

- `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`: update page-level expectations for search placeholder, toolbar count, footer states, and removal of the manual load-more button.
- `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`: add static assertions for sticky action column and centered first-column alignment.
- `desktop/src/modules/usage-analysis/cc/pages/records.tsx`: replace manual button footer with status footer and scroll sentinel; reset pagination on filter changes.
- `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx`: clarify placeholder, add toolbar count status, and add enough vertical room for the focus ring.
- `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`: make the action column sticky right and align the expand button with title text.
- `RELEASE_NOTES_PENDING.md`: add a user-facing note after implementation because the records page workflow changes.

Create:

- `desktop/src/modules/usage-analysis/cc/record-loading.ts`: pure helper for page size, status text, next range, and duplicate-load guard.
- `desktop/src/modules/usage-analysis/__tests__/record-loading.test.ts`: focused tests for helper behavior.

Do not modify Electron main-process usage-analysis services, IPC channels, preload, or bridge types for this pass.

## Task 1: Add Loading Helper Tests

**Files:**

- Create: `desktop/src/modules/usage-analysis/__tests__/record-loading.test.ts`
- Create later: `desktop/src/modules/usage-analysis/cc/record-loading.ts`

- [ ] **Step 1: Write failing tests for status text and load guards**

Create `desktop/src/modules/usage-analysis/__tests__/record-loading.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import {
  CC_RECORD_PAGE_SIZE,
  formatRecordLoadStatus,
  shouldRequestNextRecords,
} from "../cc/record-loading"

describe("CC record loading helpers", () => {
  it("uses a 50 record page size", () => {
    expect(CC_RECORD_PAGE_SIZE).toBe(50)
  })

  it("formats idle progress while more records remain", () => {
    expect(formatRecordLoadStatus({ shown: 50, total: 128, loading: false })).toBe("已显示 50 / 128")
  })

  it("formats the next loading range while existing records remain visible", () => {
    expect(formatRecordLoadStatus({ shown: 50, total: 128, loading: true })).toBe("正在加载 51-100 / 128")
  })

  it("caps the loading range at total", () => {
    expect(formatRecordLoadStatus({ shown: 100, total: 128, loading: true })).toBe("正在加载 101-128 / 128")
  })

  it("formats the all-loaded state", () => {
    expect(formatRecordLoadStatus({ shown: 128, total: 128, loading: false })).toBe("已显示全部 128 条")
  })

  it("does not return status text for an empty result", () => {
    expect(formatRecordLoadStatus({ shown: 0, total: 0, loading: false })).toBe("")
  })

  it("allows one request per visible row count", () => {
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: false,
      lastRequestedShown: null,
    })).toBe(true)
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: false,
      lastRequestedShown: 50,
    })).toBe(false)
  })

  it("blocks auto loading while loading or when all records are visible", () => {
    expect(shouldRequestNextRecords({
      shown: 50,
      total: 128,
      loading: true,
      lastRequestedShown: null,
    })).toBe(false)
    expect(shouldRequestNextRecords({
      shown: 128,
      total: 128,
      loading: false,
      lastRequestedShown: null,
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-loading.test.ts
```

Expected: FAIL because `../cc/record-loading` does not exist.

## Task 2: Implement Loading Helpers

**Files:**

- Create: `desktop/src/modules/usage-analysis/cc/record-loading.ts`
- Test: `desktop/src/modules/usage-analysis/__tests__/record-loading.test.ts`

- [ ] **Step 1: Add the pure helper implementation**

Create `desktop/src/modules/usage-analysis/cc/record-loading.ts` with:

```ts
export const CC_RECORD_PAGE_SIZE = 50

interface RecordLoadState {
  readonly shown: number
  readonly total: number
  readonly loading: boolean
}

interface RecordLoadGuardState extends RecordLoadState {
  readonly lastRequestedShown: number | null
}

export function formatRecordLoadStatus({ shown, total, loading }: RecordLoadState): string {
  if (total <= 0) return ""
  if (loading && shown > 0 && shown < total) {
    const nextStart = shown + 1
    const nextEnd = Math.min(shown + CC_RECORD_PAGE_SIZE, total)
    return `正在加载 ${nextStart}-${nextEnd} / ${total}`
  }
  if (shown >= total) return `已显示全部 ${total} 条`
  return `已显示 ${shown} / ${total}`
}

export function shouldRequestNextRecords({
  shown,
  total,
  loading,
  lastRequestedShown,
}: RecordLoadGuardState): boolean {
  return shown > 0 && shown < total && !loading && lastRequestedShown !== shown
}
```

- [ ] **Step 2: Run helper tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-loading.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit helper tests and implementation**

Run:

```bash
git add desktop/src/modules/usage-analysis/__tests__/record-loading.test.ts desktop/src/modules/usage-analysis/cc/record-loading.ts
git commit -m "test: cover CC records loading helpers"
```

## Task 3: Update Records Page Tests

**Files:**

- Modify: `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`

- [ ] **Step 1: Replace manual load-more expectations with toolbar/footer expectations**

In `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`, update the first test body to:

```ts
  it("renders record filters, progress status, and session summary actions", () => {
    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("搜标题 / 项目 / 模型 / Session ID；打开原文后搜对话内容")
    expect(html).toContain("请求")
    expect(html).toContain("打开对话")
    expect(html).toContain("已显示 1 / 128")
    expect(html).not.toContain("加载更多")
  })
```

- [ ] **Step 2: Replace the loading-button test with loading status expectations**

Replace the final test in the same file with:

```ts
  it("shows the next loading range while loading another record batch", () => {
    recordsState = { ...recordsState, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在加载 2-51 / 128")
    expect(html).not.toMatch(/<button[^>]*>[\s\S]*加载/)
  })
```

- [ ] **Step 3: Add an all-loaded footer test**

Append this test inside `describe("CcRecordsPage", () => { ... })`:

```ts
  it("shows an all-loaded footer when every matching record is visible", () => {
    recordsState = {
      ...recordsState,
      data: {
        ...recordData,
        total: 1,
      },
    }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("已显示全部 1 条")
    expect(html).not.toContain("加载更多")
  })
```

- [ ] **Step 4: Run the records page test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
```

Expected: FAIL because the page still renders the old placeholder, manual load-more button, and old footer copy.

## Task 4: Implement Search Toolbar And Scroll Footer

**Files:**

- Modify: `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/pages/records.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx`

- [ ] **Step 1: Extend `ConversationFilters` with clear placeholder and status text**

Update `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx` to:

```tsx
import { Search } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const RECORD_SEARCH_PLACEHOLDER = "搜标题 / 项目 / 模型 / Session ID；打开原文后搜对话内容"

export function ConversationFilters({
  query,
  rawText,
  statusText,
  onQueryChange,
  onRawTextChange,
}: {
  readonly query: string
  readonly rawText: boolean
  readonly statusText?: string
  readonly onQueryChange: (value: string) => void
  readonly onRawTextChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1">
      <InputGroup className="min-w-64 flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder={RECORD_SEARCH_PLACEHOLDER}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </InputGroup>
      {statusText ? (
        <span className="text-sm whitespace-nowrap text-muted-foreground">{statusText}</span>
      ) : null}
      <div className="flex h-8 items-center gap-2">
        <Label htmlFor="cc-conversation-raw-text">原文</Label>
        <Switch
          id="cc-conversation-raw-text"
          size="sm"
          checked={rawText}
          onCheckedChange={onRawTextChange}
          aria-label="原文"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace manual footer with status + sentinel in `CcRecordsPage`**

Update `desktop/src/modules/usage-analysis/cc/pages/records.tsx` imports:

```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { CcRecordListInput } from "@/types/usage-analysis-conversations"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { RecordTable } from "../components/record-table"
import { useCcRecordDetails, useCcRecords } from "../hooks"
import {
  CC_RECORD_PAGE_SIZE,
  formatRecordLoadStatus,
  shouldRequestNextRecords,
} from "../record-loading"
```

Inside `CcRecordsPage`, replace the page-size literals and add refs/status:

```tsx
  const [loadedLimit, setLoadedLimit] = useState(CC_RECORD_PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const lastRequestedShownRef = useRef<number | null>(null)
```

Update resets:

```tsx
  useEffect(() => {
    setLoadedLimit(CC_RECORD_PAGE_SIZE)
    lastRequestedShownRef.current = null
  }, [range])
```

After `initialLoading`, add:

```tsx
  const statusText = formatRecordLoadStatus({ shown, total, loading: state.loading })
```

Add this effect before `return`:

```tsx
  useEffect(() => {
    const target = loadMoreRef.current
    if (!target) return undefined

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (!shouldRequestNextRecords({
        shown,
        total,
        loading: state.loading,
        lastRequestedShown: lastRequestedShownRef.current,
      })) return

      lastRequestedShownRef.current = shown
      setLoadedLimit((current) => current + CC_RECORD_PAGE_SIZE)
    }, { rootMargin: "160px 0px" })

    observer.observe(target)
    return () => observer.disconnect()
  }, [shown, total, state.loading])
```

Pass `statusText` into filters:

```tsx
      <ConversationFilters
        query={query}
        rawText={rawText}
        statusText={!initialLoading ? statusText : undefined}
        onQueryChange={(next) => {
          setQuery(next)
          setLoadedLimit(CC_RECORD_PAGE_SIZE)
          lastRequestedShownRef.current = null
        }}
        onRawTextChange={(next) => {
          setRawText(next)
          setLoadedLimit(CC_RECORD_PAGE_SIZE)
          lastRequestedShownRef.current = null
        }}
      />
```

Replace the old footer block with:

```tsx
          {shown > 0 ? (
            <div
              ref={loadMoreRef}
              className="flex items-center justify-center border-t border-border px-3 py-2 text-sm text-muted-foreground"
              aria-busy={state.loading}
            >
              {statusText}
            </div>
          ) : null}
```

- [ ] **Step 3: Run records page tests and helper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/cc-records-page.test.tsx src/modules/usage-analysis/__tests__/record-loading.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit page loading changes**

Run:

```bash
git add desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx desktop/src/modules/usage-analysis/cc/pages/records.tsx desktop/src/modules/usage-analysis/__tests__/cc-records-page.test.tsx
git commit -m "feat: auto-load CC records on scroll"
```

## Task 5: Add Table Layout Tests

**Files:**

- Modify: `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`

- [ ] **Step 1: Add sticky action column and first-column alignment expectations**

Append these tests inside `describe("RecordTable", () => { ... })`:

```ts
  it("keeps the action column sticky on the right", () => {
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

    expect(html).toMatch(/<th[^>]*class="[^"]*sticky[^"]*right-0[^"]*bg-background[^"]*"[^>]*>操作<\/th>/)
    expect(html).toMatch(/<td[^>]*class="[^"]*sticky[^"]*right-0[^"]*bg-background[^"]*"[^>]*>[\s\S]*打开对话/)
  })

  it("aligns the expand control with the record title", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[record({ title: "github/Synapse" })]}
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

    expect(html).toContain("flex min-w-0 items-center gap-2")
  })
```

- [ ] **Step 2: Run table tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-table.test.tsx
```

Expected: FAIL because the table still uses non-sticky action cells and `items-start` for the first column.

## Task 6: Implement Table Layout Fixes

**Files:**

- Modify: `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx`

- [ ] **Step 1: Add an action column class constant**

In `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`, near `SKELETON_ROWS`, add:

```ts
const ACTION_COLUMN_CLASS = "sticky right-0 z-10 bg-background text-right"
```

- [ ] **Step 2: Apply sticky classes to header, skeleton, and data cells**

Update `RecordTableHeader` action header:

```tsx
        <TableHead className={ACTION_COLUMN_CLASS}>操作</TableHead>
```

Update `RecordTableSkeleton` action cell:

```tsx
            <TableCell className={ACTION_COLUMN_CLASS}><Skeleton className="ml-auto h-7 w-24" /></TableCell>
```

Update `RecordTable` action cell:

```tsx
                <TableCell className={ACTION_COLUMN_CLASS}>
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                    <ExternalLink data-icon="inline-start" />
                    打开对话
                  </Button>
                </TableCell>
```

- [ ] **Step 3: Center the first column row content**

In `RecordTable`, change:

```tsx
                  <div className="flex min-w-0 items-start gap-2">
```

to:

```tsx
                  <div className="flex min-w-0 items-center gap-2">
```

- [ ] **Step 4: Run table tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-table.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit table layout changes**

Run:

```bash
git add desktop/src/modules/usage-analysis/cc/components/record-table.tsx desktop/src/modules/usage-analysis/__tests__/record-table.test.tsx
git commit -m "fix: align CC records table controls"
```

## Task 7: Release Note And Final Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`
- Test: focused usage-analysis tests
- Test: desktop typecheck or project test command if focused tests pass

- [ ] **Step 1: Add a pending release note**

Add this bullet under `## 功能优化` in `RELEASE_NOTES_PENDING.md`:

```md
- 优化 CC 记录页：搜索框会说明可搜索范围，记录列表滚到底部自动继续加载，操作列固定在右侧，展开图标和标题对齐更稳定。
```

- [ ] **Step 2: Run focused usage-analysis tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/record-loading.test.ts src/modules/usage-analysis/__tests__/cc-records-page.test.tsx src/modules/usage-analysis/__tests__/record-table.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints if typecheck passes**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Commit release note and any final test fixes**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note CC records scrolling improvements"
```

If Step 2, Step 3, or Step 4 requires small fixes, include those touched files in this final commit and keep the commit message:

```bash
git add RELEASE_NOTES_PENDING.md desktop/src/modules/usage-analysis
git commit -m "docs: note CC records scrolling improvements"
```
