import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentPermissionPanel } from "../agent-permission-panel"

describe("AgentPermissionPanel", () => {
  it("wraps long SDK permission tool input without horizontal overflow", () => {
    const html = renderToStaticMarkup(
      <AgentPermissionPanel
        pendingPermissions={[{
          requestId: "permission-1",
          projectId: "project-1",
          sessionKey: "session-1",
          conversationId: "conversation-1",
          toolName: "Bash",
          toolInput: "Authorization=Bearer_".concat("x".repeat(180)),
          createdAt: "2026-05-14T00:00:00.000Z",
        }]}
        onRespond={vi.fn()}
      />,
    )

    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("break-words")
  })
})
