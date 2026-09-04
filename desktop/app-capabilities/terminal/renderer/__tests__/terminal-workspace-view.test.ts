/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest"

import { findPaneInDirection, resolveTerminalPaneDropEdge } from "../terminal-workspace-view"

describe("terminal workspace directional focus", () => {
  it("selects the nearest pane in the requested direction", () => {
    const panes = new Map<string, HTMLElement>([
      ["center", paneAt(100, 100)],
      ["left", paneAt(0, 100)],
      ["right", paneAt(200, 100)],
      ["up", paneAt(100, 0)],
      ["down", paneAt(100, 200)],
      ["far-right", paneAt(400, 100)],
    ])

    expect(findPaneInDirection("center", "left", panes)).toBe("left")
    expect(findPaneInDirection("center", "right", panes)).toBe("right")
    expect(findPaneInDirection("center", "up", panes)).toBe("up")
    expect(findPaneInDirection("center", "down", panes)).toBe("down")
  })

  it("returns null at the outer edge", () => {
    const panes = new Map<string, HTMLElement>([
      ["left", paneAt(0, 0)],
      ["right", paneAt(100, 0)],
    ])

    expect(findPaneInDirection("left", "left", panes)).toBeNull()
  })
})

describe("terminal pane drop edge", () => {
  const rect = new DOMRect(100, 200, 400, 300)

  it("resolves the closest accepted edge", () => {
    expect(resolveTerminalPaneDropEdge(300, 210, rect)).toBe("top")
    expect(resolveTerminalPaneDropEdge(490, 350, rect)).toBe("right")
    expect(resolveTerminalPaneDropEdge(300, 490, rect)).toBe("bottom")
    expect(resolveTerminalPaneDropEdge(110, 350, rect)).toBe("left")
  })

  it("does not accept the center or an invalid target rectangle", () => {
    expect(resolveTerminalPaneDropEdge(300, 350, rect)).toBeNull()
    expect(resolveTerminalPaneDropEdge(0, 0, new DOMRect())).toBeNull()
  })
})

function paneAt(left: number, top: number): HTMLElement {
  return {
    getBoundingClientRect: () => new DOMRect(left, top, 100, 100),
  } as HTMLElement
}
