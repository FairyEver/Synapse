/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentSlashMenu } from "../components/agent-slash-menu"
import type { AgentSlashCandidate } from "../slash-menu"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const candidates: AgentSlashCandidate[] = [
  {
    name: "wiki-query",
    description: "查询知识库并基于已有页面回答",
    kind: "knowledgeBase",
    insertText: "/wiki-query ",
  },
  {
    name: "review-code",
    description: "Review code changes",
    kind: "skill",
    source: "skill",
  },
  {
    name: "status",
    description: "Show agent status",
    kind: "command",
    source: "builtin",
  },
]

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

describe("AgentSlashMenu", () => {
  it("keeps names and descriptions on one compact line and truncates overflow", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={[{
          name: "electron-windows-compat-audit",
          description: "Use when auditing or fixing an Electron app for Windows compatibility",
          kind: "skill",
          source: "skill",
        }]}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const container = document.createElement("div")
    container.innerHTML = html
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    const item = container.querySelector<HTMLElement>('[role="option"]')

    expect(html).toContain("h-8")
    expect(html).toContain("whitespace-nowrap")
    expect(html).toContain("truncate")
    expect(html).not.toContain("break-words")
    expect(viewport?.className).toContain("overflow-x-hidden")
    expect(viewport?.className).toContain("[&>div]:!block")
    expect(viewport?.className).toContain("[&>div]:!max-w-full")
    expect(item?.className).toContain("rounded-sm")
  })

  it("sets the scroll viewport height so the menu can scroll", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("max-h-72")
  })

  it("matches the composer width and aligns with both sides", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("left-0")
    expect(html).toContain("right-0")
    expect(html).toContain("w-full")
    expect(html).not.toContain("w-80")
    expect(html).not.toContain("left-2")
  })

  it("scrolls the highlighted item into view", async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSlashMenu
          candidates={candidates}
          highlightedIndex={0}
          onHighlight={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
    })

    await act(async () => {
      root.render(
        <AgentSlashMenu
          candidates={candidates}
          highlightedIndex={1}
          onHighlight={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
    })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it("renders knowledge base, skills, and commands in order", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("知识库")
    expect(html).toContain("Skills")
    expect(html).toContain("Commands")
    expect(html.indexOf("知识库")).toBeLessThan(html.indexOf("Skills"))
    expect(html.indexOf("Skills")).toBeLessThan(html.indexOf("Commands"))
    expect(html).toContain("/wiki-query")
    expect(html).toContain("查询知识库并基于已有页面回答")
    expect(html).toContain("/review-code")
    expect(html).toContain("Review code changes")
    expect(html).toContain("/status")
    expect(html).toContain("Show agent status")
  })

  it("does not render quick input slash items", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).not.toContain("data-slash-candidate-kind=\"quickInput\"")
  })

  it("renders a short empty state", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={[]}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("No matches")
  })

  it("selects a clicked item", async () => {
    const onSelect = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSlashMenu
          candidates={candidates}
          highlightedIndex={0}
          onHighlight={vi.fn()}
          onSelect={onSelect}
        />,
      )
    })

    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("/status"))
    expect(button).toBeDefined()

    await act(async () => {
      button?.click()
    })

    expect(onSelect).toHaveBeenCalledWith(candidates[2])
  })
})
