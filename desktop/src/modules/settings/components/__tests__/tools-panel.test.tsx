import { createElement, type ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ToolsPanel } from "@/modules/settings/components/tools-panel"

vi.mock("@/modules/settings/components/editor-directories-panel", () => ({
  EditorDirectoriesContent: () => <div>IDE</div>,
}))

vi.mock("@/modules/settings/components/agent-runtime-panel", () => ({
  AgentRuntimePanel: ({ projectId }: { readonly projectId?: string }) => (
    <div>Agent project: {projectId ?? "global"}</div>
  ),
}))

describe("ToolsPanel", () => {
  it("renders Agent runtime status globally", () => {
    const LegacyToolsPanel = ToolsPanel as ComponentType<{ readonly projectId?: string }>
    const html = renderToStaticMarkup(createElement(LegacyToolsPanel, { projectId: "project-1" }))

    expect(html).toContain("Agent project: global")
  })
})
