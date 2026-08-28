import { describe, expect, it } from "vitest"
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

  it("renders session and request timestamps in a visible time column", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[record({
          sessionId: "s1",
          lastUsedAt: "2026-05-27T01:00:01",
        })]}
        expandedSessionId="s1"
        detailRows={[{
          id: "u1",
          usageEventId: "u1",
          timestamp: "2026-05-27T01:00:00",
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
        detailTotal={1}
        detailLoading={false}
        onToggleExpanded={() => undefined}
        onOpenConversation={() => undefined}
        onOpenDetail={() => undefined}
        onLoadMoreDetails={() => undefined}
      />,
    )

    expect(html).toContain("时间")
    expect(html).toContain("2026/05/27 01:00")
  })

  it("distinguishes unpriced records from zero-cost priced records", () => {
    const unpricedRecord = {
      ...record({ estimatedCost: 0, tokens: 15 }),
      pricedTokens: 0,
      unpricedTokens: 15,
    } as CcRecordListItem
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[unpricedRecord]}
        expandedSessionId={unpricedRecord.sessionId}
        detailRows={[{
          id: "u1",
          usageEventId: "u1",
          timestamp: "2026-05-27T01:00:00.000Z",
          sessionId: unpricedRecord.sessionId,
          workspaceLabel: "workspace",
          model: "model-a",
          tokens: 15,
          pricedTokens: 0,
          unpricedTokens: 15,
          estimatedCost: 0,
          tokenBreakdown: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          toolCalls: 0,
        }]}
        detailTotal={1}
        detailLoading={false}
        onToggleExpanded={() => undefined}
        onOpenConversation={() => undefined}
        onOpenDetail={() => undefined}
        onLoadMoreDetails={() => undefined}
      />,
    )

    expect(html.match(/未定价/g)).toHaveLength(2)
    expect(html).not.toContain("¥0.00")
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

  it("keeps the last path segment when visible rows share the same value", () => {
    const html = renderToStaticMarkup(
      <RecordTable
        rows={[
          record({ sessionId: "s1", title: "/Users/me/work/Synapse", workspaceLabel: "/Users/me/work/Synapse" }),
          record({ sessionId: "s2", title: "/Users/me/work/Synapse", workspaceLabel: "/Users/me/work/Synapse" }),
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

    expect(html).toMatch(/title="\/Users\/me\/work\/Synapse"[^>]*>Synapse<\/span>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/Synapse"[^>]*>Synapse<\/td>/)
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

    expect(html).toMatch(/<th[^>]*class="[^"]*sticky[^"]*right-0[^"]*bg-surface[^"]*"[^>]*>操作<\/th>/)
    expect(html).toMatch(/<td[^>]*class="[^"]*sticky[^"]*right-0[^"]*bg-surface[^"]*"[^>]*>[\s\S]*打开对话/)
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
    pricedTokens: 15,
    unpricedTokens: 0,
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
