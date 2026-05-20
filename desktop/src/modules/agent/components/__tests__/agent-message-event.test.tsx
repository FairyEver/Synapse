/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentMessageEvent, wrapLocalReferences } from "../agent-message-event"

const { rendererLogger, track } = vi.hoisted(() => ({
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
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
      .map((link) => link.getAttribute("href"))

    expect(links).toContain("https://example.com/docs")
    expect(links).toContain("./local/file.ts")
    expect(links).not.toContain("example.com/docs")
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
      .map((link) => link.getAttribute("href"))

    expect(codeText?.trim()).toBe('const path = "./src/private/file.ts"')
    expect(links).toContain("./docs/readme.md")
    expect(links).not.toContain("./src/private/file.ts")
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
      .map((link) => link.getAttribute("href"))

    expect(codeText).toBe("./src/private/file.ts")
    expect(links).toContain("./docs/readme.md")
    expect(links).not.toContain("./src/private/file.ts")
  })

  it("keeps local references inside unterminated inline code unchanged while streaming", () => {
    const wrapped = wrapLocalReferences("Reading `./src/private/file.ts while open ./docs/readme.md")

    expect(wrapped).toBe("Reading `./src/private/file.ts while open ./docs/readme.md")
  })

  it("renders streaming assistant drafts as literal text until final markdown arrives", async () => {
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
            content: "1. **skill",
            timestamp: "2026-04-27T03:15:00.000Z",
            streaming: true,
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    expect(container.querySelector("ol")).toBeNull()
    expect(container.querySelector("strong")).toBeNull()
    expect(container.textContent).toContain("1. **skill")
  })

  it("keeps sentence punctuation outside auto-wrapped local reference links", () => {
    const wrapped = wrapLocalReferences("Open ./README.md. Then inspect desktop/src/App.tsx:12;")

    expect(wrapped).toBe("Open [./README.md](./README.md). Then inspect [desktop/src/App.tsx:12](desktop/src/App.tsx:12);")
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

    const copyButton = container.querySelector<HTMLButtonElement>(".code-copy-btn")
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
        codeLength: 28,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("do-not-log")
  })

  it("styles injected code copy controls with classes instead of inline styles", async () => {
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
    const copyButton = container.querySelector<HTMLButtonElement>(".code-copy-btn")

    expect(pre).not.toBeNull()
    expect(copyButton).not.toBeNull()
    expect(pre?.getAttribute("style")).toBeNull()
    expect(pre?.classList.contains("relative")).toBe(true)
    expect(copyButton?.getAttribute("style")).toBeNull()
    expect(copyButton?.classList.contains("absolute")).toBe(true)
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

    const link = container.querySelector<HTMLAnchorElement>("a[href='./private/secret-file.ts']")
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

  it("logs assistant code block copy failures with message context", async () => {
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

    const copyButton = container.querySelector<HTMLButtonElement>(".code-copy-btn")
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(window.navigator.clipboard.writeText).toHaveBeenCalled()
    expect(rendererLogger.warn).toHaveBeenCalledWith("agent.code.copy.failed", {
      boundary: "renderer.agent.code-copy",
      messageId: "message-123",
      role: "assistant",
      contentLength: 37,
      codeLength: 28,
      errorName: "NotAllowedError",
      errorLength: "Permission denied for clipboard".length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("do-not-log")
  })
})
