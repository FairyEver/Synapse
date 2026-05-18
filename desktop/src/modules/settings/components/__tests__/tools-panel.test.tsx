import { createElement, type ComponentType, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ClaudeCodePanel } from "@/modules/settings/components/claude-code-panel"
import { ToolsPanel } from "@/modules/settings/components/tools-panel"

vi.mock("@/modules/settings/components/editor-directories-panel", () => ({
  EditorDirectoriesContent: () => <div>IDE</div>,
}))

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

describe("ToolsPanel", () => {
  it("renders editor settings without Agent runtime status", () => {
    const LegacyToolsPanel = ToolsPanel as ComponentType<{ readonly projectId?: string }>
    const html = renderToStaticMarkup(createElement(LegacyToolsPanel, { projectId: "project-1" }))

    expect(html).toContain("IDE")
    expect(html).not.toContain("Agent project:")
  })

  it("renders Claude Code Agent runtime status globally", () => {
    const html = renderToStaticMarkup(<ClaudeCodePanel />)

    expect(html).toContain("Agent project: global")
    expect(html).toContain("Agent defaults")
  })
})
