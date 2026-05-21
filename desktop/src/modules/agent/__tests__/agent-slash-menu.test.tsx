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
  it("wraps long names and descriptions instead of truncating them", () => {
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

    expect(html).toContain("whitespace-normal")
    expect(html).toContain("break-words")
    expect(html).not.toContain("truncate")
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

  it("renders skills and commands in separate groups", () => {
    const html = renderToStaticMarkup(
      <AgentSlashMenu
        candidates={candidates}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(html).toContain("Skills")
    expect(html).toContain("Commands")
    expect(html).toContain("/review-code")
    expect(html).toContain("Review code changes")
    expect(html).toContain("/status")
    expect(html).toContain("Show agent status")
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

    expect(onSelect).toHaveBeenCalledWith(candidates[1])
  })
})
