/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentToolEvent } from "../agent-tool-event"

const rendererLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

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
    expect(html).toContain("Running")
    expect(html).toContain("pnpm test")
    expect(html).toContain("w-full")
    expect(html).not.toContain("border-y border-border")
    expect(html.indexOf("Bash")).toBeLessThan(html.indexOf("Running"))
    expect(html.indexOf("Running")).toBeLessThan(html.indexOf("lucide-chevron-down"))
    expect(html).toContain("group-data-[state=closed]/agent-event-trigger:-rotate-90")
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

  it("treats failed status without success as a failed tool result", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-status-failed",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "command failed",
        status: "failed",
        exitCode: 1,
      }}
      profile={profile}
    />)

    expect(html).toContain("Failed")
    expect(html).toContain("command failed")
    expect(html).toContain("exit 1")
    expect(html).not.toContain("Done")
  })

  it("shows denied tool results with the profile denied label", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-status-denied",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "permission denied",
        status: "denied",
      }}
      profile={profile}
    />)

    expect(html).toContain("Denied")
    expect(html).toContain("permission denied")
    expect(html).not.toContain("Failed")
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
    expect(html).toContain("lucide-clipboard")
  })

  it("makes the copy action visible when hovering tool output", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-hover-copy",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "command output",
        success: true,
      }}
      profile={profile}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    const body = container.querySelector("pre")
    const outputGroup = body?.closest(".group")
    const copyButton = outputGroup?.querySelector("button")

    expect(outputGroup?.className.split(" ")).toContain("group")
    expect(copyButton?.className).toContain("group-hover:opacity-100")
    expect(copyButton?.getAttribute("aria-label")).toBe("复制工具输出")
  })

  it("wraps long tool output without enabling horizontal scrollbars", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-long-json",
        kind: "toolCall",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Todo",
        toolInput: `{"todos":[{"content":"${"读取新来源文件和当前清单".repeat(20)}","status":"in_progress"}]}`,
      }}
      profile={{
        ...profile,
        toolDefaultCollapsed: "expanded",
        toolPreviewChars: 2000,
      }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    const output = container.querySelector("pre")
    const outputFrame = output?.parentElement

    expect(html).not.toContain("data-orientation=\"horizontal\"")
    expect(outputFrame?.className).toContain("overflow-x-hidden")
    expect(outputFrame?.className).toContain("max-w-full")
    expect(output?.className).toContain("break-all")
    expect(output?.textContent).toContain("读取新来源文件和当前清单")
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

  it("redacts sensitive raw tool input fallback before rendering", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-raw",
        kind: "toolCall",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        toolInputRaw: {
          apiKey: "sk-secret",
          file_path: "/Users/liyang/private/project/file.ts",
          nested: {
            authorization: "Bearer sk-auth",
          },
        },
      }}
      profile={{
        ...profile,
        tools: {},
        toolDefaultCollapsed: "expanded",
        toolPreviewChars: 400,
      }}
    />)

    expect(html).toContain("[redacted]")
    expect(html).toContain("/Users/liyang/private/project/file.ts")
    expect(html).not.toContain("sk-secret")
    expect(html).not.toContain("sk-auth")
  })

  it("preserves path-like tool input strings before rendering", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-string",
        kind: "toolCall",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        toolInput: "cat /tmp/file.ts && type C:\\tmp\\file.ts",
      }}
      profile={{
        ...profile,
        toolDefaultCollapsed: "expanded",
        toolPreviewChars: 400,
      }}
    />)

    expect(html).toContain("/tmp/file.ts")
    expect(html).not.toContain("[path redacted]")
  })

  it("logs tool body copy failures without recording tool content", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() },
    })
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard denied for token=sk-secret"))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
        item={{
          id: "tool-copy",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:00.000Z",
          toolName: "Bash",
          content: "token=sk-secret",
          success: true,
        }}
        profile={profile}
      />)
    })

    const copyButton = container.querySelectorAll("button")[1]
    expect(copyButton).toBeTruthy()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith(
      "Agent tool body copy failed.",
      expect.objectContaining({
        boundary: "renderer.agent.tool-copy",
        itemId: "tool-copy",
        kind: "toolResult",
        toolName: "Bash",
        bodyLength: "token=sk-secret".length,
        errorName: "Error",
        errorLength: "clipboard denied for token=sk-secret".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=sk-secret")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("clipboard denied")
  })

  it("tracks tool body copy clicks without recording tool content", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() },
    })
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
        item={{
          id: "tool-copy-track",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:00.000Z",
          toolName: "Bash",
          content: "token=sk-secret",
          success: true,
        }}
        profile={profile}
      />)
    })

    const copyButton = container.querySelectorAll("button")[1]
    expect(copyButton).toBeTruthy()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(rendererLogger.info).toHaveBeenCalledWith(
      "agent-tool-copy:click",
      expect.objectContaining({
        component: "agent",
        name: "agent-tool-copy",
        action: "click",
        metadata: expect.objectContaining({
          boundary: "renderer.agent.tool-copy",
          itemId: "tool-copy-track",
          kind: "toolResult",
          toolName: "Bash",
          bodyLength: "token=sk-secret".length,
        }),
      }),
    )
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("token=sk-secret")
  })
})
