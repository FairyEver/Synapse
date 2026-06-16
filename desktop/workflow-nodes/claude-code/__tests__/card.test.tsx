import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ClaudeCodeNodeCard } from "../card"
import { defaultClaudeCodeNodeConfig } from "../schema"

vi.mock("@/modules/workflow/components/copy-id-button", () => ({
  CopyIdButton: ({ id }: { id: string }) => <span>{id}</span>,
}))

vi.mock("@/modules/workflow/runner/node-progress-bar", () => ({
  NodeProgressBar: () => <div />,
  useRunningTimer: () => "",
}))

describe("ClaudeCodeNodeCard", () => {
  it("renders permission mode and prompt summary", () => {
    const html = renderToStaticMarkup(
      <ClaudeCodeNodeCard
        config={{ ...defaultClaudeCodeNodeConfig, prompt: "Review this change", permissionMode: "plan" }}
        nodeId="claude-1"
      />,
    )

    expect(html).toContain("Claude Code")
    expect(html).toContain("plan")
    expect(html).toContain("Review this change")
  })
})
