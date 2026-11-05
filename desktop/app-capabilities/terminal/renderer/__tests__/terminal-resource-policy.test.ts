import { describe, expect, it } from "vitest"
import { retainedTerminalWorkspaces } from "../terminal-workspace-cache"
import { createTerminalProjectionQueue } from "../terminal-projection-queue"
import { terminalUtf8ByteLength } from "../../shared/utf8-byte-length"
import type { TerminalLayoutNode, TerminalWorkspace } from "../../shared/workspace"

describe("terminal renderer resource policy", () => {
  it("keeps the active eight-pane tab and evicts all background panes", () => {
    const workspaces = [workspace("old", 1), workspace("active", 8)]
    expect(retainedTerminalWorkspaces(["old"], "active", workspaces)).toEqual(["active"])
  })

  it("keeps at most two recently visited tabs and eight panes after layout changes", () => {
    const tabs = [workspace("one", 5), workspace("two", 4), workspace("three", 3)]
    expect(retainedTerminalWorkspaces(["one", "three"], "two", tabs)).toEqual(["two", "three"])
    expect(retainedTerminalWorkspaces(["removed", "two"], "three", tabs)).toEqual(["three", "two"])
    expect(retainedTerminalWorkspaces(["one"], null, tabs)).toEqual([])
  })

  it("bounds empty and Unicode projection chunks, clears references, and wraps in order", () => {
    const queue = createTerminalProjectionQueue({ maxBytes: 6, maxChunks: 2 })
    const chunk = (seq: number, data: string) => ({ seq, data, sessionId: "session", createdAt: "now", source: "pty" as const })
    expect(queue.append(chunk(1, "你"))).toBe(true)
    expect(queue.append(chunk(2, ""))).toBe(true)
    expect(queue.append(chunk(3, "a"))).toBe(false)
    expect(queue.shift()?.seq).toBe(1)
    expect(queue.append(chunk(3, "😃"))).toBe(true)
    expect(queue.shift()?.seq).toBe(2)
    expect(queue.shift()?.seq).toBe(3)
    expect(queue.diagnostics()).toMatchObject({ pendingBytes: 0, pendingChunks: 0, rejectedChunks: 1 })
    expect(queue.append(chunk(4, "你你你"))).toBe(false)
    queue.clear()
    expect(queue.peek()).toBeUndefined()
  })

  it.each(["", "ASCII", "你好", "😃", "\ud800", "a\udc00b", "\ud800😃\udfff"])("counts UTF-8 bytes without an encoding allocation (%j)", (value) => {
    expect(terminalUtf8ByteLength(value)).toBe(Buffer.byteLength(value, "utf8"))
  })
})

function workspace(id: string, panes: number): TerminalWorkspace {
  const leaf = (index: number): TerminalLayoutNode => ({ type: "leaf", paneId: `${id}-${index}`, sessionId: `${id}-${index}` })
  let layout = leaf(0)
  for (let index = 1; index < panes; index += 1) layout = { type: "split", splitId: `${id}-split-${index}`, direction: "horizontal", ratio: 0.5, first: layout, second: leaf(index) }
  return { id, groupId: "group", title: id, pinned: false, layout, layoutRevision: 1, closing: false, closingPaneIds: [], createdAt: "now", updatedAt: "now" }
}
