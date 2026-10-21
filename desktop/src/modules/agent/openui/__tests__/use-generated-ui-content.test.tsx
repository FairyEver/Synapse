// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"
import { useGeneratedUiContent } from "../use-generated-ui-content"

const bridge = vi.hoisted(() => ({ getTimelineContentChunk: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => bridge }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
let host: HTMLDivElement
let root: Root
const item = { id: "message", kind: "message", role: "assistant", content: "truncated", timestamp: "2026-10-21", historyIndex: 3,
  contentTruncated: true, metadata: { generatedUi: { version: 1, libraryVersion: "openui@0.18.1/lang@1.0.1", turnId: "turn", blocks: [] } },
} satisfies SynapseAgentMessageTimelineItem
function Harness({ conversationId }: { conversationId: string }) {
  const value = useGeneratedUiContent(item, "p", conversationId)
  return <div>{value.loading ? "loading" : value.error ?? value.content}</div>
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks() })

describe("generated UI full history content", () => {
  it("does not expose the truncated preview while loading all ordered chunks", async () => {
    let resolve!: (value: unknown) => void
    bridge.getTimelineContentChunk.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce({ content: "last", nextOffset: 9, done: true })
    await act(async () => root.render(<Harness conversationId="source" />))
    expect(host.textContent).toBe("loading")
    await act(async () => resolve({ content: "first", nextOffset: 5, done: false }))
    expect(host.textContent).toBe("firstlast")
    expect(bridge.getTimelineContentChunk.mock.calls[1][0]).toMatchObject({ conversationId: "source", historyIndex: 3, offset: 5 })
  })
  it("ignores a late read after switching source conversations", async () => {
    let resolve!: (value: unknown) => void
    bridge.getTimelineContentChunk.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce({ content: "new", nextOffset: 3, done: true })
    await act(async () => root.render(<Harness conversationId="old" />))
    await act(async () => root.render(<Harness conversationId="new" />))
    await act(async () => resolve({ content: "old", nextOffset: 3, done: true }))
    expect(host.textContent).toBe("new")
  })
  it("falls back explicitly when history exceeds the bounded read budget", async () => {
    bridge.getTimelineContentChunk.mockResolvedValue({ content: "x".repeat(2 * 1024 * 1024 + 1), nextOffset: 1, done: true })
    await act(async () => root.render(<Harness conversationId="source" />))
    expect(host.textContent).toContain("查看全文")
    expect(host.textContent).not.toContain("truncated")
  })
})
