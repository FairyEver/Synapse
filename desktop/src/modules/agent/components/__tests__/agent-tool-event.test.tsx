import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentToolEvent } from "../agent-tool-event"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "collapsed",
  toolPreviewLines: 6,
  toolPreviewChars: 20,
  aliases: {
    Bash: "Bash",
  },
  tools: {
    Bash: { defaultCollapsed: "expanded", previewChars: 20 },
  },
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

describe("AgentToolEvent", () => {
  it("uses profile aliases and opens tools configured as expanded", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-1",
        kind: "toolCall",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        toolInput: "pnpm test",
      }}
      profile={profile}
    />)

    expect(html).toContain("Bash")
    expect(html).not.toContain("Running")
    expect(html).toContain("pnpm test")
    expect(html).toContain("w-full")
    expect(html).not.toContain("lucide-terminal")
    expect(html).not.toContain("border-y border-border")
    expect(html.indexOf("Bash")).toBeLessThan(html.indexOf("lucide-chevron-down"))
  })

  it("places result status next to the tool title", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-success",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "ok",
        success: true,
      }}
      profile={profile}
    />)

    expect(html).toContain("Done")
    expect(html).not.toContain("justify-between")
    expect(html.indexOf("Bash")).toBeLessThan(html.indexOf("Done"))
    expect(html.indexOf("Done")).toBeLessThan(html.indexOf("lucide-chevron-down"))
  })

  it("opens failed tool results even when profile default is collapsed", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-2",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "UnknownTool",
        content: "boom",
        success: false,
      }}
      profile={profile}
    />)

    expect(html).toContain("UnknownTool")
    expect(html).toContain("Failed")
    expect(html).toContain("boom")
  })

  it("keeps exit code and copy action for expanded tool results", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-3",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "command output",
        exitCode: 2,
        success: false,
      }}
      profile={profile}
    />)

    expect(html).toContain("command output")
    expect(html).toContain("exit 2")
    expect(html).toContain("复制")
    expect(html).toContain("lucide-clipboard")
  })

  it("opens permission requests by default", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "permission-1",
        kind: "permissionRequest",
        timestamp: "2026-04-28T00:00:00.000Z",
        requestId: "request-1",
        toolName: "Bash",
        toolInput: "rm file",
      }}
      profile={profile}
    />)

    expect(html).toContain("Pending")
    expect(html).toContain("rm file")
  })
})
