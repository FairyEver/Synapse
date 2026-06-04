import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "../archived-group"

const archivedSession: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "archived-conv",
  sessionKey: "local:archived-conv",
  name: "Archived Claude Session",
  active: false,
  historyCount: 3,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T01:00:00.000Z",
}

describe("ArchivedGroup", () => {
  it("opens when the selected Agent session is archived", () => {
    const html = renderToStaticMarkup(
      <ArchivedGroup
        sessions={[archivedSession]}
        selectedProjectId="project-1"
        selectedConversationId="archived-conv"
        unreadByConversationId={{}}
        sendingConversationIds={new Set()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain('data-state="open"')
    expect(html).toContain("Archived Claude Session")
  })
})
