import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConversationTable } from "../cc/components/conversation-table"
import type { CcConversationListItem } from "@/types/usage-analysis-conversations"

describe("ConversationTable", () => {
  it("removes shared path prefixes from title and project columns", () => {
    const html = renderToStaticMarkup(
      <ConversationTable
        rows={[
          row({ sessionId: "s1", title: "a/b/c", workspaceLabel: "/Users/me/work/alpha" }),
          row({ sessionId: "s2", title: "a/b/d", workspaceLabel: "/Users/me/work/beta" }),
        ]}
        onOpen={() => undefined}
      />,
    )

    expect(html).toMatch(/title="a\/b\/c"[^>]*>c<\/span>/)
    expect(html).toMatch(/title="a\/b\/d"[^>]*>d<\/span>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/alpha"[^>]*>alpha<\/td>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/beta"[^>]*>beta<\/td>/)
  })

  it("keeps the last path segment when visible rows share the same value", () => {
    const html = renderToStaticMarkup(
      <ConversationTable
        rows={[
          row({ sessionId: "s1", title: "/Users/me/work/Synapse", workspaceLabel: "/Users/me/work/Synapse" }),
          row({ sessionId: "s2", title: "/Users/me/work/Synapse", workspaceLabel: "/Users/me/work/Synapse" }),
        ]}
        onOpen={() => undefined}
      />,
    )

    expect(html).toMatch(/title="\/Users\/me\/work\/Synapse"[^>]*>Synapse<\/span>/)
    expect(html).toMatch(/title="\/Users\/me\/work\/Synapse"[^>]*>Synapse<\/td>/)
  })
})

function row(overrides: Partial<CcConversationListItem>): CcConversationListItem {
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
    lastUsedAt: "2026-05-27T01:00:01.000Z",
    sourceFilePath: "/tmp/session.jsonl",
    ...overrides,
  }
}
