import { type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ClaudeCodePanel } from "@/modules/settings/components/claude-code-panel"

vi.mock("@/modules/settings/components/agent-runtime-panel", () => ({
  AgentRuntimePanel: ({
    children,
    projectId,
  }: {
    readonly children?: ReactNode
    readonly projectId?: string
  }) => (
    <div>
      Agent project: {projectId ?? "global"}
      {children}
    </div>
  ),
}))

vi.mock("@/modules/settings/components/agent-defaults-panel", () => ({
  AgentDefaultsContent: () => <div>Agent defaults</div>,
}))

vi.mock("@/modules/settings/components/provider-panel", () => ({
  ProviderPanel: () => <div>Provider panel</div>,
}))

describe("ClaudeCodePanel", () => {
  it("renders Agent runtime status globally", () => {
    const html = renderToStaticMarkup(<ClaudeCodePanel />)

    expect(html).toContain("Agent project: global")
    expect(html).toContain("Agent defaults")
    expect(html).toContain("Provider panel")
  })
})
