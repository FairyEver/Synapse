import { createElement, type ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ToolsPanel } from "@/modules/settings/components/tools-panel"
import { ProviderPanelView } from "@/modules/settings/components/provider-panel"
import type { SynapseAgentProvider } from "@/types/bridge"

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [{ id: "project-1", name: "Test Project", path: "/tmp/test" }],
      },
    },
  }),
}))

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

  it("renders providers without leaking api key values", () => {
    const providers = [{
      id: "anthropic",
      name: "Anthropic",
      category: "official",
      baseUrl: "https://api.anthropic.com",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-should-never-render",
      active: true,
      model: "claude-sonnet-4-5",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }] as unknown as SynapseAgentProvider[]
    const html = renderToStaticMarkup(
      <ProviderPanelView
        projectId="project-1"
        projectName="Test Project"
        providers={providers}
        loading={false}
        error={null}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onSetActive={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(html).toContain("Anthropic")
    expect(html).toContain("claude-sonnet-4-5")
    expect(html).not.toContain("sk-should-never-render")
  })
})
