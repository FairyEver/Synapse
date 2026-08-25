/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile, SynapseAgentMessageTimelineItem } from "@/types/agent"
import { AgentMessageEvent } from "../components/agent-message-event"

const baseEntry = {
  id: "message-1",
  kind: "message",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentMessageTimelineItem, "role">

const mockProfile: SynapseAgentDisplayProfile = {
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
  it("right-aligns user messages with a subtle outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-end")
    expect(html).toContain("bg-muted")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("bg-primary")
  })

  it("user messages do not render a header with avatar", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).not.toContain("lucide-user")
    expect(html).not.toContain("lucide-bot")
  })

  it("user messages have a toolbar with copy button and time", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
    const d = new Date(baseEntry.timestamp)
    const expected = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
    expect(html).toContain(expected)
  })

  it.each([
    [1, "1"],
    [2, "2"],
    [3, "2"],
    [4, "2"],
    [5, "3"],
    [8, "3"],
    [9, "3"],
  ])("renders %i user images with the expected grid columns", (count, columns) => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "user",
          attachments: Array.from({ length: count }, (_, index) => ({
            kind: "image" as const,
            id: `image-${index}`,
            name: `image-${index}.png`,
            mimeType: "image/png" as const,
            byteSize: 3,
            url: `synapse-agent-artifact://local/project/conversation/image-${index}.png`,
          })),
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain(`data-image-count="${count}"`)
    expect(html).toContain(`data-grid-columns="${columns}"`)
  })

  it("renders a compact nine-image preview for 50 message images and keeps all images in the lightbox", async () => {
    const item = {
      ...baseEntry,
      role: "user" as const,
      attachments: Array.from({ length: 50 }, (_, index) => ({
        kind: "image" as const,
        id: `image-${index}`,
        name: `image-${index}.png`,
        mimeType: "image/png" as const,
        byteSize: 3,
        url: `synapse-agent-artifact://local/project/conversation/image-${index}.png`,
      })),
    }
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={item}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('data-image-count="50"')
    expect(html.match(/<img/g)).toHaveLength(9)
    expect(html).toContain("max-w-sm")
    expect(html).toContain("+41")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<AgentMessageEvent item={item} profile={mockProfile} onOpenReference={vi.fn()} />)
    })
    const previewButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="预览"]')
    await act(async () => previewButtons[8]?.click())
    expect(document.querySelector("[data-image-lightbox]")?.textContent).toContain("9 / 50")
  })

  it("renders attachment-only messages without placeholder text or copy action", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "user",
          content: "",
          attachments: [{
            kind: "image",
            id: "image-1",
            name: "screen.png",
            mimeType: "image/png",
            byteSize: 3,
            url: "synapse-agent-artifact://local/project/conversation/image-1.png",
          }],
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("screen.png")
    expect(html).not.toContain("[Image #1]")
    expect(html).not.toContain('aria-label="复制"')
  })

  it("opens path attachments through the existing local reference callback", async () => {
    const onOpenReference = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            ...baseEntry,
            role: "user",
            attachments: [{
              kind: "path",
              path: "/Users/liyang/Desktop/report.pdf",
              entryType: "file",
              name: "report.pdf",
              byteSize: 2048,
            }],
          }}
          profile={mockProfile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const button = container.querySelector<HTMLButtonElement>('button[title="/Users/liyang/Desktop/report.pdf"]')
    expect(button?.textContent).toContain("report.pdf")
    expect(button?.textContent).toContain("PDF")
    await act(async () => button?.click())
    expect(onOpenReference).toHaveBeenCalledWith("/Users/liyang/Desktop/report.pdf")
  })

  it("opens user images in the existing lightbox at the selected image", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            ...baseEntry,
            role: "user",
            attachments: ["first", "second"].map((name) => ({
              kind: "image" as const,
              id: name,
              name: `${name}.png`,
              mimeType: "image/png" as const,
              byteSize: 3,
              url: `https://example.com/${name}.png`,
            })),
          }}
          profile={mockProfile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const previewButton = container.querySelector<HTMLButtonElement>('button[aria-label="预览second.png"]')
    await act(async () => previewButton?.click())

    expect(document.querySelector("[data-image-lightbox]")?.textContent).toContain("2 / 2")
    expect(document.querySelector("[data-image-lightbox-active]")?.getAttribute("src"))
      .toBe("https://example.com/second.png")
  })

  it("shows a concise fallback when a user image cannot load", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            ...baseEntry,
            role: "user",
            attachments: [{
              kind: "image",
              id: "broken-image",
              name: "broken.png",
              mimeType: "image/png",
              byteSize: 3,
              url: "synapse-agent-artifact://local/project/conversation/broken.png",
            }],
          }}
          profile={mockProfile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const image = container.querySelector("img")
    await act(async () => image?.dispatchEvent(new Event("error")))
    expect(container.textContent).toContain("broken.png")
    expect(container.textContent).toContain("图片无法加载")
  })

  it("left-aligns assistant messages with markdown rendering", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant", content: "**bold text**" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-start")
    expect(html).toContain('data-streamdown="strong"')
    expect(html).toContain("bold text")
  })

  it("assistant messages show agent icon when provided", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        agentIcon="/icons/claude.png"
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('src="/icons/claude.png"')
    expect(html).not.toContain("lucide-bot")
  })

  it("assistant messages have a toolbar with copy button", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
  })

  it("assistant messages render token usage metadata", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          metadata: {
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 40,
            },
          },
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="用量统计"')
    expect(html).toContain("输入")
    expect(html).toContain("100")
    expect(html).toContain("输出")
    expect(html).toContain("20")
    expect(html).toContain("缓存读")
    expect(html).toContain("300")
    expect(html).toContain("缓存写")
    expect(html).toContain("40")
  })

  it("wraps local references as markdown links for assistant", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "/Users/liyang/project/file.ts:12",
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("<a")
    expect(html).toContain("/Users/liyang/project/file.ts:12")
  })

  it("does not link slash-separated app labels in assistant messages", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "余额退款申请单(蛋鸡APP/PC)；养殖户模板(PC/APP)",
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).not.toContain("<a href")
    expect(html).toContain("蛋鸡APP/PC")
    expect(html).toContain("PC/APP")
  })

  it("opens wrapped relative file references through the reference bridge", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onOpenReference = vi.fn()

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            ...baseEntry,
            role: "assistant",
            content: "desktop/src/modules/agent/index.tsx:12",
          }}
          profile={mockProfile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector("a")
    expect(link?.getAttribute("data-reference")).toBe("desktop/src/modules/agent/index.tsx:12")

    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpenReference).toHaveBeenCalledWith("desktop/src/modules/agent/index.tsx:12")
  })
})
