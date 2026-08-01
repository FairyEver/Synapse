import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"

vi.mock("@/definitions/generated/renderer-registry", () => ({
  agentDefinitions: [
    { id: "codex", icon: "codex-agent.png" },
    { id: "claude-code", icon: "claude-code-agent.png" },
  ],
}))

vi.mock("@/modules/settings/hooks/use-agent-runtime-status", () => ({
  useAgentRuntimeStatus: () => ({
    loading: false,
    refresh: vi.fn(),
    status: {
      agents: [
        {
          id: "codex",
          label: "Codex",
          ready: true,
          cli: {
            required: true,
            binary: "codex",
            installed: true,
            path: "/usr/local/bin/codex",
          },
          provider: {
            projectId: "project-1",
            configured: true,
            activeProviderId: "openai",
            activeModel: "gpt-5",
          },
          issues: [],
        },
        {
          id: "claude-code",
          label: "CC/Synapse",
          ready: false,
          cli: {
            required: true,
            binary: "claude",
            installed: false,
            path: null,
          },
          provider: {
            projectId: "project-1",
            configured: false,
          },
          issues: ["cli-not-installed", "provider-not-configured"],
        },
      ],
      projectId: "project-1",
    },
  }),
}))

describe("AgentRuntimePanel", () => {
  it("renders agent runtime readiness without the panel header", () => {
    const html = renderToStaticMarkup(<AgentRuntimePanel projectId="project-1" />)

    expect(html).toContain("Codex")
    expect(html).toContain("codex-agent.png")
    expect(html).toContain("可用")
    expect(html).toContain("CC/Synapse")
    expect(html).toContain("claude-code-agent.png")
    expect(html).toContain("未就绪")
    expect(html).toContain("未检测到 claude")
    expect(html).not.toContain("重新检测")
    expect(html).not.toContain("命令行工具")
  })
})
