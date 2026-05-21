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
