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

const widePreviewProfile: SynapseAgentDisplayProfile = {
  ...profile,
  tools: {
    ...profile.tools,
    Bash: { ...profile.tools?.Bash, previewChars: 400 },
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

async function clickToolTrigger(container: HTMLElement) {
  const trigger = container.querySelector("button")
  expect(trigger).toBeTruthy()
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("AgentToolEvent", () => {
  it("uses profile aliases and opens running tools by default", () => {
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

  it("collapses successful completed tools even when configured as expanded", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-success-collapsed",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "ok",
        success: true,
      }}
      profile={{
        ...profile,
        toolDefaultCollapsed: "expanded",
      }}
    />)

    expect(html).toContain("Bash")
    expect(html).toContain("Done")
    expect(html).toContain("data-state=\"closed\"")
    const container = document.createElement("div")
    container.innerHTML = html
    expect(container.textContent).not.toContain("ok")
  })

  it("collapses a running tool after it receives a successful result", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const item = {
      id: "tool-call-success",
      kind: "toolCall" as const,
      timestamp: "2026-04-28T00:00:00.000Z",
      toolName: "Bash",
      toolInput: "pnpm test",
    }

    await act(async () => {
      root.render(<AgentToolEvent item={item} profile={profile} />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("open")
    expect(container.textContent).toContain("pnpm test")

    await act(async () => {
      root.render(<AgentToolEvent
        item={item}
        result={{
          id: "tool-result-success",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:01.000Z",
          toolName: "Bash",
          content: "ok",
          success: true,
        }}
        profile={widePreviewProfile}
      />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("closed")
    expect(container.textContent).not.toContain("pnpm test")
    expect(container.textContent).not.toContain("ok")
  })

  it("collapses a running tool after it receives a failed result", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const item = {
      id: "tool-call-failed",
      kind: "toolCall" as const,
      timestamp: "2026-04-28T00:00:00.000Z",
      toolName: "Bash",
      toolInput: "pnpm test",
    }

    await act(async () => {
      root.render(<AgentToolEvent item={item} profile={profile} />)
    })

    await act(async () => {
      root.render(<AgentToolEvent
        item={item}
        result={{
          id: "tool-result-failed",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:01.000Z",
          toolName: "Bash",
          content: "boom",
          success: false,
        }}
        profile={widePreviewProfile}
      />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("closed")
    expect(container.textContent).toContain("Failed")
    expect(container.textContent).not.toContain("pnpm test")
    expect(container.textContent).not.toContain("boom")
  })

  it("does not override a manual collapse when a successful result arrives", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const item = {
      id: "tool-call-manual-collapse",
      kind: "toolCall" as const,
      timestamp: "2026-04-28T00:00:00.000Z",
      toolName: "Bash",
      toolInput: "pnpm test",
    }

    await act(async () => {
      root.render(<AgentToolEvent item={item} profile={profile} />)
    })

    await clickToolTrigger(container)

    await act(async () => {
      root.render(<AgentToolEvent
        item={item}
        result={{
          id: "tool-result-manual-collapse",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:01.000Z",
          toolName: "Bash",
          content: "ok",
          success: true,
        }}
        profile={profile}
      />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("closed")
  })

  it("does not override a manual expansion when a successful result arrives", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const item = {
      id: "tool-call-manual-expand",
      kind: "toolCall" as const,
      timestamp: "2026-04-28T00:00:00.000Z",
      toolName: "Bash",
      toolInput: "pnpm test",
    }

    await act(async () => {
      root.render(<AgentToolEvent item={item} profile={profile} />)
    })

    await clickToolTrigger(container)
    await clickToolTrigger(container)

    await act(async () => {
      root.render(<AgentToolEvent
        item={item}
        result={{
          id: "tool-result-manual-expand",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:01.000Z",
          toolName: "Bash",
          content: "ok",
          success: true,
        }}
        profile={widePreviewProfile}
      />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("open")
    expect(container.textContent).toContain("ok")
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

  it("redacts secret-shaped tool result content before rendering", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
        item={{
          id: "tool-secret",
          kind: "toolResult",
          timestamp: "2026-04-28T00:00:00.000Z",
          toolName: "Bash",
          content: "ANTHROPIC_AUTH_TOKEN=sk-render Authorization: Bearer sk-bearer /Users/liyang/project/file.ts",
          success: true,
        }}
        profile={widePreviewProfile}
      />)
    })

    await clickToolTrigger(container)

    expect(container.textContent).toContain("[redacted]")
    expect(container.textContent).toContain("/Users/liyang/project/file.ts")
    expect(container.textContent).not.toContain("sk-render")
    expect(container.textContent).not.toContain("sk-bearer")
  })

  it("renders image artifact thumbnails for image tool results", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
        item={{
          id: "tool-image",
          kind: "toolResult",
          timestamp: "2026-07-03T00:00:00.000Z",
          toolName: "Read",
          toolUseId: "toolu-1",
          imageArtifacts: [{
            id: "artifact-1",
            kind: "image",
            mimeType: "image/png",
            byteSize: 4,
            url: "/Users/liyang/Library/Application Support/Synapse/agent-artifacts/project_1/conversation_1/artifact-1.png",
          }, {
            id: "artifact-2",
            kind: "image",
            mimeType: "image/webp",
            byteSize: 8,
            url: "https://example.com/artifact-2.webp",
          }],
          success: true,
        }}
        profile={profile}
      />)
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("open")
    const image = container.querySelector("img[alt='Read image 1']")
    const previewButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="预览图片 2"]',
    )
    expect(image).toBeTruthy()
    expect(image?.getAttribute("src")).toBe("synapse-agent-artifact://local/project_1/conversation_1/artifact-1.png")
    expect(previewButton).toBeTruthy()
    expect(container.querySelector("a")).toBeNull()

    await act(async () => previewButton?.click())

    expect(document.querySelector("[data-image-lightbox]")).toBeTruthy()
    expect(document.querySelector("[data-image-lightbox]")?.textContent).toContain("2 / 2")
    expect(document.querySelector("[data-image-lightbox-active]")?.getAttribute("src"))
      .toBe("https://example.com/artifact-2.webp")
  })

  it("collapses failed tool results while keeping the failed status visible", () => {
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
    expect(html).toContain("data-state=\"closed\"")
    expect(html).not.toContain("boom")
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
    expect(html).not.toContain("command failed")
    expect(html).not.toContain("exit 1")
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
    expect(html).toContain("data-state=\"closed\"")
    expect(html).not.toContain("permission denied")
    expect(html).not.toContain("Failed")
  })

  it("keeps exit code and copy action when a failed tool result is expanded", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
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
    })

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("closed")
    expect(container.textContent).not.toContain("command output")

    await clickToolTrigger(container)

    expect(container.querySelector("[data-slot='collapsible']")?.getAttribute("data-state")).toBe("open")
    expect(container.textContent).toContain("command output")
    expect(container.textContent).toContain("exit 2")
    expect(container.innerHTML).toContain("lucide-clipboard")
  })

  it("makes the copy action visible when hovering tool output", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentToolEvent
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
    })
    await clickToolTrigger(container)

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
        profile={{
          ...profile,
          toolDefaultCollapsed: "expanded",
        }}
      />)
    })

    await clickToolTrigger(container)
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
        bodyLength: "token=[redacted]".length,
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
        profile={{
          ...profile,
          toolDefaultCollapsed: "expanded",
        }}
      />)
    })

    await clickToolTrigger(container)
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
          bodyLength: "token=[redacted]".length,
        }),
      }),
    )
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("token=sk-secret")
  })
})
