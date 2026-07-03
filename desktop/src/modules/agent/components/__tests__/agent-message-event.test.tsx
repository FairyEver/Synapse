/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import {
  AgentMessageEvent,
  renderObsidianWikilinksAsBoldText,
  wrapLocalReferences,
} from "../agent-message-event"

const { rendererLogger, shellBridge, track } = vi.hoisted(() => ({
  shellBridge: {
    openExternal: vi.fn(),
  },
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => shellBridge,
}))

vi.mock("@/lib/ui-tracking", () => ({
  track,
}))

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Claude",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
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
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(),
    },
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentMessageEvent", () => {
  it("renders Obsidian wikilinks as bold plain text", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-wikilinks",
            kind: "message",
            role: "assistant",
            content: "Pages: [[Synapse Platform]], [[Workflow Loop Mechanism|工作流循环]], ![[diagram.png]]",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const boldItems = Array.from(container.querySelectorAll("[data-streamdown='strong']"))
      .map((item) => item.textContent)

    expect(boldItems).toEqual(["Synapse Platform", "工作流循环", "diagram.png"])
    expect(container.textContent).not.toContain("[[")
    expect(container.textContent).not.toContain("]]")
    expect(container.textContent).not.toContain("!diagram.png")
    expect(container.querySelectorAll("a")).toHaveLength(0)
  })

  it("keeps Obsidian wikilinks inside code unchanged", () => {
    const rendered = renderObsidianWikilinksAsBoldText(
      "Keep `[[Internal Page]]` literal.\n```md\n[[Code Page]]\n```\nShow [[Visible Page]]",
    )

    expect(rendered).toBe(
      "Keep `[[Internal Page]]` literal.\n```md\n[[Code Page]]\n```\nShow **Visible Page**",
    )
  })

  it("renders markdown tables with a single Agent table border", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-table",
            kind: "message",
            role: "assistant",
            content: [
              "| 页面 | 类型 |",
              "|------|------|",
              "| [[智慧人生管理思想]] | 概念 — 管理体系 |",
            ].join("\n"),
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const streamdownWrapper = container.querySelector("[data-streamdown='table-wrapper']")
    const table = container.querySelector<HTMLTableElement>("[data-streamdown='table']")
    const tableContainer = table?.parentElement

    expect(streamdownWrapper).toBeNull()
    expect(table).not.toBeNull()
    expect(tableContainer?.getAttribute("data-streamdown")).toBe("table-container")
    expect(tableContainer?.className).toContain("border-border")
    expect(table?.className).not.toContain("border-border")
    expect(container.querySelector("th")?.textContent).toBe("页面")
    expect(container.textContent).toContain("智慧人生管理思想")
    expect(container.textContent).not.toContain("[[智慧人生管理思想]]")
  })

  it("keeps external protocol URLs intact when wrapping local references", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-url",
            kind: "message",
            role: "assistant",
            content: "See https://example.com/docs and ./local/file.ts",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .map((link) => link.getAttribute("data-reference"))

    expect(links).toContain("https://example.com/docs")
    expect(links).toContain("./local/file.ts")
    expect(links).not.toContain("example.com/docs")
  })

  it("does not auto-wrap bare domain paths as local references", () => {
    const wrapped = wrapLocalReferences("See github.com/FairyEver/Synapse and open desktop/src/App.tsx")

    expect(wrapped).toBe("See github.com/FairyEver/Synapse and open [desktop/src/App.tsx](./desktop/src/App.tsx)")
  })

  it("keeps local references inside fenced code blocks unchanged", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-code-path",
            kind: "message",
            role: "assistant",
            content: "```ts\nconst path = \"./src/private/file.ts\"\n```\nOpen ./docs/readme.md",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const codeText = container.querySelector("code")?.textContent
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .map((link) => link.getAttribute("data-reference"))

    expect(codeText?.trim()).toBe('const path = "./src/private/file.ts"')
    expect(links).toContain("./docs/readme.md")
    expect(links).not.toContain("./src/private/file.ts")
  })

  it("renders local markdown image references as clickable references", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-local-image",
            kind: "message",
            role: "assistant",
            content: "![probe](/tmp/synapse-sdk-image-display-probe/case-1-read-png.png)",
            timestamp: "2026-07-03T00:00:00.000Z",
          }}
          profile={profile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a")
    expect(container.querySelector("img")).toBeNull()
    expect(link?.textContent).toBe("probe")
    expect(link?.getAttribute("data-reference")).toBe("/tmp/synapse-sdk-image-display-probe/case-1-read-png.png")
  })

  it("keeps local references inside inline code unchanged", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-inline-code-path",
            kind: "message",
            role: "assistant",
            content: "Keep `./src/private/file.ts` literal, but open ./docs/readme.md",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const codeText = container.querySelector("code")?.textContent
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .map((link) => link.getAttribute("data-reference"))

    expect(codeText).toBe("./src/private/file.ts")
    expect(links).toContain("./docs/readme.md")
    expect(links).not.toContain("./src/private/file.ts")
  })

  it("keeps local references inside unterminated inline code unchanged while streaming", () => {
    const wrapped = wrapLocalReferences("Reading `./src/private/file.ts while open ./docs/readme.md")

    expect(wrapped).toBe("Reading `./src/private/file.ts while open ./docs/readme.md")
  })

  it("renders streaming assistant drafts as markdown while content is incomplete", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-streaming",
            kind: "message",
            role: "assistant",
            content: "1. **skill**",
            timestamp: "2026-04-27T03:15:00.000Z",
            streaming: true,
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    expect(container.querySelector("ol")).not.toBeNull()
    expect(container.querySelector("[data-streamdown='strong']")?.textContent).toBe("skill")
  })

  it("keeps sentence punctuation outside auto-wrapped local reference links", () => {
    const wrapped = wrapLocalReferences("Open ./README.md. Then inspect desktop/src/App.tsx:12;")

    expect(wrapped).toBe("Open [./README.md](./README.md). Then inspect [desktop/src/App.tsx:12](./desktop/src/App.tsx:12);")
  })

  it("wraps Windows local references in assistant plain text", () => {
    const wrapped = wrapLocalReferences(
      String.raw`Open C:\workspace\project\src\app.ts:12, \\server\share\file.md and src\file.ts.`,
    )

    expect(wrapped).toBe(
      String.raw`Open [C:\workspace\project\src\app.ts:12](<./C:\workspace\project\src\app.ts:12>), [\\server\share\file.md](<./\\server\share\file.md>) and [src\file.ts](<./src\file.ts>).`,
    )
  })

  it("tracks assistant code block copy clicks without logging code content", async () => {
    vi.mocked(window.navigator.clipboard.writeText).mockResolvedValue(undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-123",
            kind: "message",
            role: "assistant",
            content: "```ts\nconst secret = 'do-not-log'\n```",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const copyButton = container.querySelector<HTMLButtonElement>("[data-streamdown='code-block-copy-button']")
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-code-copy",
      action: "click",
      metadata: {
        boundary: "renderer.agent.code-copy",
        messageId: "message-123",
        role: "assistant",
        contentLength: 37,
        codeLength: 27,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("do-not-log")
  })

  it("renders streamdown code copy controls without leaking inline styles on controls", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-copy-style",
            kind: "message",
            role: "assistant",
            content: "```ts\nconst value = 1\n```",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const pre = container.querySelector("pre")
    const copyButton = container.querySelector<HTMLButtonElement>("[data-streamdown='code-block-copy-button']")

    expect(pre).not.toBeNull()
    expect(copyButton).not.toBeNull()
    expect(copyButton?.getAttribute("style")).toBeNull()
    expect(copyButton?.classList.contains("cursor-pointer")).toBe(true)
  })

  it("constrains streamdown code blocks inside assistant messages", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-code-layout",
            kind: "message",
            role: "assistant",
            content: "## 新增知识地图\n\n```text\n实施后首次对比 Synapse Knowledge Base 功能差距总结\n├── 概念：自然语言 Ingest 路由\n└── 实体：DragonScale\n```",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const codeBlock = container.querySelector<HTMLElement>("[data-streamdown='code-block']")
    const pre = codeBlock?.querySelector("pre")
    const code = pre?.querySelector("code")
    const markdownRoot = codeBlock?.parentElement
    const messageFrame = codeBlock?.closest(".group\\/message")

    expect(codeBlock).not.toBeNull()
    expect(pre?.className).toContain("!m-0")
    expect(pre?.className).toContain("!rounded-none")
    expect(pre?.className).toContain("!border-0")
    expect(pre?.className).toContain("!bg-transparent")
    expect(code?.className).toContain("!p-0")
    expect(messageFrame?.className).toContain("min-w-0")
    expect(messageFrame?.className).toContain("max-w-[76ch]")
    expect(codeBlock?.getAttribute("style")).toBeNull()
    expect(markdownRoot?.className).toContain("[&_[data-streamdown='code-block']]:max-w-full")
    expect(markdownRoot?.className).toContain("[&_[data-streamdown='code-block']]:overflow-hidden")
    expect(codeBlock?.textContent).toContain("实施后首次对比 Synapse Knowledge Base 功能差距总结")
  })

  it("tracks local reference open clicks without logging the raw reference", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference",
            kind: "message",
            role: "assistant",
            content: "Open ./private/secret-file.ts",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference='./private/secret-file.ts']")
    expect(link).not.toBeNull()

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpenReference).toHaveBeenCalledWith("./private/secret-file.ts")
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-reference-open",
      action: "click",
      metadata: {
        boundary: "renderer.agent.reference-open",
        messageId: "message-reference",
        role: "assistant",
        contentLength: 29,
        referenceLength: 24,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("./private/secret-file.ts")
  })

  it("opens Windows local references from assistant messages", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const windowsReference = String.raw`C:\workspace\project\src\app.ts:12`

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-windows-reference",
            kind: "message",
            role: "assistant",
            content: `Open ${windowsReference}`,
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
    const linkSummaries = links.map((link) => ({
      href: link.getAttribute("href"),
      reference: link.getAttribute("data-reference"),
      text: link.textContent,
    }))
    expect(linkSummaries).toContainEqual({
      href: expect.any(String),
      reference: windowsReference,
      text: windowsReference,
    })
    const link = links.find((item) => item.getAttribute("data-reference") === windowsReference)

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpenReference).toHaveBeenCalledWith(windowsReference)
    expect(shellBridge.openExternal).not.toHaveBeenCalled()
  })

  it("does not log raw external link credentials when opening fails", async () => {
    shellBridge.openExternal.mockRejectedValue(new Error("denied"))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const href = "https://user:pass@example.com/path?token=secret-value&query=ok&code=oauth-code"

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-link",
            kind: "message",
            role: "assistant",
            content: `[Open link](${href})`,
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a")
    expect(link).not.toBeNull()

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(shellBridge.openExternal).toHaveBeenCalledWith(href)
    expect(rendererLogger.warn).toHaveBeenCalledWith(
      "agent.external-link.open.failed",
      expect.objectContaining({
        hrefLength: href.length,
        url: "https://example.com/path?token=%5Bredacted%5D&query=ok&code=%5Bredacted%5D",
      }),
    )
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret-value")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("oauth-code")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("user:pass")
  })

  it("does not log code content when streamdown code copy fails", async () => {
    const clipboardError = new DOMException("Permission denied for clipboard", "NotAllowedError")
    vi.mocked(window.navigator.clipboard.writeText).mockRejectedValue(clipboardError)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-123",
            kind: "message",
            role: "assistant",
            content: "```ts\nconst secret = 'do-not-log'\n```",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const copyButton = container.querySelector<HTMLButtonElement>("[data-streamdown='code-block-copy-button']")
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(window.navigator.clipboard.writeText).toHaveBeenCalled()
    expect(rendererLogger.warn).not.toHaveBeenCalled()
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("do-not-log")
  })

  it("renders an Agent usage card for assistant messages with usage metadata", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-usage-card",
            kind: "message",
            role: "assistant",
            content: "Done",
            timestamp: "2026-06-02T06:32:00.000Z",
            metadata: {
              usage: {
                inputTokens: 10248,
                outputTokens: 3812,
                cacheReadInputTokens: 42180,
                cacheCreationInputTokens: 1216,
                reasoningOutputTokens: 680,
                totalTokens: 58136,
              },
              turnUsage: {
                input_tokens: 2104,
                output_tokens: 846,
                cache_read_input_tokens: 9640,
                cache_creation_input_tokens: 0,
                reasoning_output_tokens: 180,
              },
              costCny: 0.18,
              costUsd: 0.05,
              totalCostCny: 1.42,
              estimatedCost: true,
            },
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("用量统计")
    expect(container.textContent).toContain("¥0.18")
    expect(container.textContent).toContain("¥1.42")
    expect(container.textContent).not.toContain("费用 $0.05")
    expect(container.textContent).toContain("10,248")
    expect(container.querySelector("[aria-label='Token 消耗']")).toBeNull()
    expect(container.textContent).not.toContain("会话累计 输入")
  })

  it("does not render an Agent usage card without usage metadata", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-no-usage-card",
            kind: "message",
            role: "assistant",
            content: "Done",
            timestamp: "2026-06-02T06:32:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    expect(container.textContent).not.toContain("用量统计")
  })
})
