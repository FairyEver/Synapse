import { describe, expect, it } from "vitest"

import {
  collectTerminalPaneLeaves,
  equalizeTerminalPaneGroup,
  findTerminalPaneParentDirection,
  findTerminalPaneSplitPath,
  moveTerminalPane,
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

  it("finds every ancestor split needed to maximize a nested pane", () => {
    const right = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "vertical",
      ratio: 0.4,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const middleAndRight = splitTerminalPane(right, "pane-b", {
      splitId: "split-b",
      direction: "horizontal",
      ratio: 0.7,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!
    const nested = splitTerminalPane(middleAndRight, "pane-b", {
      splitId: "split-c",
      direction: "horizontal",
      ratio: 0.2,
    }, { type: "leaf", paneId: "pane-d", sessionId: "session-d" })!

    expect(findTerminalPaneSplitPath(nested, "pane-d")).toEqual([
      { splitId: "split-a", paneSide: "second" },
      { splitId: "split-b", paneSide: "first" },
      { splitId: "split-c", paneSide: "second" },
    ])
    expect(findTerminalPaneSplitPath(nested, "missing")).toBeNull()
  })

  it("equalizes every pane in the same continuous horizontal group", () => {
    const first = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.2,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const nested = splitTerminalPane(first, "pane-b", {
      splitId: "split-b",
      direction: "horizontal",
      ratio: 0.75,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!

    expect(findTerminalPaneParentDirection(nested, "pane-c")).toBe("horizontal")
    expect(equalizeTerminalPaneGroup(nested, "pane-c")).toMatchObject({
      type: "split",
      splitId: "split-a",
      ratio: 1 / 3,
      second: {
        type: "split",
        splitId: "split-b",
        ratio: 0.5,
      },
    })
  })

  it("equalizes a continuous horizontal group when the nested split is on the left", () => {
    const first = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.8,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const nested = splitTerminalPane(first, "pane-a", {
      splitId: "split-b",
      direction: "horizontal",
      ratio: 0.25,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!

    expect(equalizeTerminalPaneGroup(nested, "pane-c")).toMatchObject({
      type: "split",
      splitId: "split-a",
      ratio: 2 / 3,
      first: {
        type: "split",
        splitId: "split-b",
        ratio: 0.5,
      },
    })
  })

  it("equalizes only the direct vertical group inside a mixed layout", () => {
    const columns = splitTerminalPane(root, "pane-a", {
      splitId: "split-columns",
      direction: "horizontal",
      ratio: 0.3,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const mixed = splitTerminalPane(columns, "pane-b", {
      splitId: "split-rows",
      direction: "vertical",
      ratio: 0.8,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!

    expect(findTerminalPaneParentDirection(mixed, "pane-c")).toBe("vertical")
    expect(equalizeTerminalPaneGroup(mixed, "pane-c")).toMatchObject({
      type: "split",
      splitId: "split-columns",
      ratio: 0.3,
      second: {
        type: "split",
        splitId: "split-rows",
        ratio: 0.5,
      },
    })
  })

  it("moves a pane from a right split to the bottom of its target", () => {
    const layout = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.5,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!

    expect(moveTerminalPane(layout, "pane-b", "pane-a", "bottom", "split-b")).toEqual({
      type: "split",
      splitId: "split-b",
      direction: "vertical",
      ratio: 0.5,
      first: root,
      second: { type: "leaf", paneId: "pane-b", sessionId: "session-b" },
    })
  })

  it("reparents a pane in a nested layout without changing its session", () => {
    const right = splitTerminalPane(root, "pane-a", {
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.4,
    }, { type: "leaf", paneId: "pane-b", sessionId: "session-b" })!
    const nested = splitTerminalPane(right, "pane-b", {
      splitId: "split-b",
      direction: "vertical",
      ratio: 0.6,
    }, { type: "leaf", paneId: "pane-c", sessionId: "session-c" })!

    expect(moveTerminalPane(nested, "pane-c", "pane-a", "left", "split-c")).toEqual({
      type: "split",
      splitId: "split-a",
      direction: "horizontal",
      ratio: 0.4,
      first: {
        type: "split",
        splitId: "split-c",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", paneId: "pane-c", sessionId: "session-c" },
        second: root,
      },
      second: { type: "leaf", paneId: "pane-b", sessionId: "session-b" },
    })
  })

  it("rejects moving a pane onto itself or using an unknown pane", () => {
    expect(moveTerminalPane(root, "pane-a", "pane-a", "right", "split-a")).toBeNull()
    expect(moveTerminalPane(root, "missing", "pane-a", "right", "split-a")).toBeNull()
  })
})
