import { describe, expect, it } from "vitest"

import {
  collectTerminalPaneLeaves,
  removeTerminalPane,
  setTerminalSplitRatio,
  splitTerminalPane,
  type TerminalLayoutNode,
} from "../workspace"

describe("terminal workspace layout", () => {
  const root: TerminalLayoutNode = { type: "leaf", paneId: "pane-a", sessionId: "session-a" }

  it("recursively splits only the requested leaf", () => {
    const first = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.5,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const nested = splitTerminalPane(first, "pane-b", {
      splitId: "split-b",
      direction: "vertical",
      ratio: 0.5,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!

    expect(collectTerminalPaneLeaves(nested).map((pane) => pane.paneId)).toEqual([
      "pane-a",
      "pane-b",
      "pane-c",
    ])
    expect(nested).toMatchObject({
      type: "split",
      splitId: "split-a",
      second: { type: "split", splitId: "split-b", direction: "vertical" },
    })
  })

  it("collapses the removed pane parent without changing the surviving subtree", () => {
    const layout = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.5,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!

    expect(removeTerminalPane(layout, "pane-a")).toEqual({
      type: "leaf",
      paneId: "pane-b",
      sessionId: "session-b",
    })
    expect(removeTerminalPane(layout, "missing")).toBeUndefined()
  })

  it("updates one stable split id and preserves unrelated nodes", () => {
    const layout = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.5,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!

    expect(setTerminalSplitRatio(layout, "split-a", 0.65)).toEqual({
      ...layout,
      ratio: 0.65,
    })
    expect(setTerminalSplitRatio(layout, "missing", 0.65)).toBeNull()
  })
})
