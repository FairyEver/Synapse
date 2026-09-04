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

const { rendererLogger, shellBridge, toastError, track } = vi.hoisted(() => ({
  shellBridge: {
    openExternal: vi.fn(),
  },
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  toastError: vi.fn(),
  track: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => shellBridge,
}))

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: (element: HTMLElement) => element.textContent?.trim(),
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
  it("redacts sensitive assistant content before rendering and copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const localPath = "/Users/liyang/project/file.ts"

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-sensitive",
            kind: "message",
            role: "assistant",
            content: `Authorization: Bearer sk-assistant-secret\nOpen ${localPath}`,
            timestamp: "2026-07-16T03:00:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("Authorization: Bearer [redacted]")
    expect(container.textContent).toContain(localPath)
    expect(container.textContent).not.toContain("sk-assistant-secret")

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="复制"]')?.click()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith(`Authorization: Bearer [redacted]\nOpen ${localPath}`)
  })

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
    const tableContainer = container.querySelector("[data-streamdown='table-container']")

    expect(streamdownWrapper).toBeNull()
    expect(table).not.toBeNull()
    expect(tableContainer?.getAttribute("data-streamdown")).toBe("table-container")
    expect(tableContainer?.getAttribute("data-scrollbars")).toBe("horizontal")
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

  it("does not render numeric change totals as local references", () => {
    const content = "git 增量（57/-30），用户总量（+11,586/-3,570）"

    expect(wrapLocalReferences(content)).toBe(content)
  })

  it("renders file URL markdown links containing spaces as local references", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const localPath = "/Users/liyang/Downloads/Easy Worklog/待发送/2026-07-20-工作总结.md"

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-file-url-with-spaces",
            kind: "message",
            role: "assistant",
            content: `已完成。总结稿路径：[\`${localPath}\`](file://${localPath})`,
            timestamp: "2026-07-20T10:34:16.000Z",
          }}
          profile={profile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a")
    expect(link?.textContent).toBe(localPath)
    expect(link?.getAttribute("data-reference")).toBe(localPath)
    expect(container.textContent).not.toContain("[blocked]")
    expect(container.textContent).not.toContain("file://")

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpenReference).toHaveBeenCalledWith(localPath)
    expect(shellBridge.openExternal).not.toHaveBeenCalled()
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
      eventKey: "agent.code.copy",
      metadata: {
        boundary: "renderer.agent.code-copy",
        messageId: "message-123",
        role: "assistant",
        contentLength: 37,
        codeLength: 25,
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
      eventKey: "agent.reference.open",
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

  it("shows the two fixed local-reference actions and keeps the alias selectable", async () => {
    const openDefault = vi.fn(async () => ({ ok: true as const }))
    const showInFolder = vi.fn(async () => ({
      ok: false as const,
      code: "not_found_or_inaccessible" as const,
    }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-menu",
            kind: "message",
            role: "assistant",
            content: "[打开报告](/tmp/private-report.json:12:3)",
            timestamp: "2026-07-23T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
          referenceActions={{ openDefault, showInFolder }}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
    expect(link?.textContent).toBe("打开报告")
    expect(link?.className).toContain("select-text")

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }))
      await Promise.resolve()
    })

    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "使用默认应用打开",
      "在文件夹中显示",
    ])
    expect(items[0]?.querySelector("svg")?.getAttribute("class")).toContain("lucide-external-link")
    expect(items[1]?.querySelector("svg")?.getAttribute("class")).toContain("lucide-folder-search")

    await act(async () => {
      items[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(openDefault).toHaveBeenCalledWith("/tmp/private-report.json:12:3")
    expect(toastError).not.toHaveBeenCalled()

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }))
      await Promise.resolve()
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')[1]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(showInFolder).toHaveBeenCalledWith("/tmp/private-report.json:12:3")
    expect(toastError).toHaveBeenCalledWith("在文件夹中显示失败")
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      name: "agent-reference-show-in-folder",
      action: "complete",
      metadata: expect.objectContaining({
        operation: "show_in_folder",
        messageId: "message-reference-menu",
        result: "not_found_or_inaccessible",
      }),
    }))
    expect(JSON.stringify(track.mock.calls)).not.toContain("/tmp/private-report.json")
  })

  it("keeps completed local-reference text selectable and preserves Enter and left-click opening", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-selection",
            kind: "message",
            role: "assistant",
            content: "[报告别名](/tmp/report.json)",
            timestamp: "2026-07-23T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
    const range = document.createRange()
    range.selectNodeContents(link as Node)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true })
    link?.dispatchEvent(copyEvent)
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
    link?.dispatchEvent(enterEvent)

    expect(window.getSelection()?.toString()).toBe("报告别名")
    expect(copyEvent.defaultPrevented).toBe(false)
    expect(enterEvent.defaultPrevented).toBe(false)

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }))
    })
    expect(onOpenReference).toHaveBeenCalledWith("/tmp/report.json")
  })

  it("folds an IPC rejection into the generic Toast and ipc_failure telemetry", async () => {
    const privatePath = "/tmp/private-report.json"
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-ipc-failure",
            kind: "message",
            role: "assistant",
            content: privatePath,
            timestamp: "2026-07-23T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
          referenceActions={{
            openDefault: vi.fn(async () => {
              throw new Error(`native failure for ${privatePath}`)
            }),
            showInFolder: vi.fn(),
          }}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }))
      await Promise.resolve()
      document.body.querySelector<HTMLElement>('[role="menuitem"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("打开失败")
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      name: "agent-reference-open-default",
      metadata: expect.objectContaining({ result: "ipc_failure" }),
    }))
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain(privatePath)
    expect(JSON.stringify(track.mock.calls)).not.toContain(privatePath)
  })

  it("opens the same completed-reference menu with Shift+F10", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-keyboard",
            kind: "message",
            role: "assistant",
            content: "/tmp/report.json",
            timestamp: "2026-07-23T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
    link?.focus()
    await act(async () => {
      link?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "F10",
        code: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }))
      await Promise.resolve()
    })

    expect(Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim()))
      .toEqual(["使用默认应用打开", "在文件夹中显示"])
  })

  it("opens the same completed-reference menu with the Context Menu key", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-context-menu-key",
            kind: "message",
            role: "assistant",
            content: "/tmp/report.json",
            timestamp: "2026-07-23T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
    link?.focus()
    await act(async () => {
      link?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ContextMenu",
        code: "ContextMenu",
        bubbles: true,
        cancelable: true,
      }))
      await Promise.resolve()
    })

    expect(Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim()))
      .toEqual(["使用默认应用打开", "在文件夹中显示"])
  })

  it.each(["user", "system", "tool"] as const)(
    "does not enable local-reference actions for %s messages",
    async (role) => {
      const openDefault = vi.fn(async () => ({ ok: true as const }))
      const showInFolder = vi.fn(async () => ({ ok: true as const }))
      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)
      roots.push(root)

      await act(async () => {
        root.render(
          <AgentMessageEvent
            item={{
              id: `message-reference-${role}`,
              kind: "message",
              role,
              content: "/tmp/report.json",
              timestamp: "2026-07-23T03:15:00.000Z",
            }}
            profile={profile}
            onOpenReference={vi.fn()}
            referenceActions={{
              openDefault,
              showInFolder,
            }}
          />,
        )
      })

      const link = container.querySelector<HTMLAnchorElement>("a[data-reference]")
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      })
      await act(async () => {
        link?.dispatchEvent(event)
        await Promise.resolve()
      })

      expect(document.body.querySelector('[role="menuitem"]')).toBeNull()
      expect(openDefault).not.toHaveBeenCalled()
      expect(showInFolder).not.toHaveBeenCalled()
    },
  )

  it("suppresses the native local-link menu while the assistant message is streaming", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-reference-streaming",
            kind: "message",
            role: "assistant",
            content: "/tmp/report.json",
            timestamp: "2026-07-23T03:15:00.000Z",
            streaming: true,
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    })
    container.querySelector<HTMLAnchorElement>("a[data-reference]")?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull()
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
