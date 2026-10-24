/** @vitest-environment jsdom */
import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAgentShare } from "../use-agent-share"
import type { SynapseAgentTimelineItem } from "@/types/agent"
const bridge = vi.hoisted(() => ({ getTimeline: vi.fn(), getTimelineContentChunk: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => bridge }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const items = [1, 2, 3, 4].map((id) => ({ id: `m${id}`, historyIndex: id - 1, kind: "message" as const, role: id % 2 ? "user" as const : "assistant" as const, content: `${id}`, timestamp: "2026-10-24T00:00:00Z" }))
let root: Root | undefined
let controller: ReturnType<typeof useAgentShare>
function Driver({ conversationId = "c", timeline = items, sending = false }: { conversationId?: string; timeline?: readonly SynapseAgentTimelineItem[]; sending?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  controller = useAgentShare({ target: { projectId: "p", sessionKey: "s", conversationId }, title: "test", items: timeline, sending, viewport })
  return <div ref={viewport} />
}
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.clearAllMocks() })
function mount() { root = createRoot(document.createElement("div")); act(() => root!.render(<Driver />)) }
function history() { return { projectId: "p", conversationId: "c", sessionKey: "s", entries: items, total: 4, startIndex: 0, hasMore: false } }

describe("Agent sharing lifecycle", () => {
  it("selects in place, previews only chosen content, and preserves choices on returning", async () => {
    bridge.getTimeline.mockResolvedValue(history()); mount()
    await act(async () => controller.enter())
    expect(controller.active).toBe(true); expect(controller.selected.size).toBe(0)
    act(() => controller.choose("m1", false)); act(() => controller.choose("m4", true))
    expect(controller.selected.size).toBe(4)
    act(() => controller.preset("ai")); await act(() => controller.openPreview())
    expect(controller.preview?.map((item) => item.id)).toEqual(["m2", "m4"])
    act(() => controller.closePreview()); expect(controller.selected.size).toBe(2)
    act(() => controller.exit()); expect(controller.active).toBe(false)
  })
  it("invalidates old history after exiting and after changing conversation", async () => {
    let resolve!: (result: ReturnType<typeof history>) => void
    bridge.getTimeline.mockImplementation(() => new Promise((done) => { resolve = done })); mount()
    act(() => { void controller.enter("m2") }); expect(controller.selected.has("m2")).toBe(true)
    act(() => controller.exit()); await act(async () => resolve(history()))
    expect(controller.active).toBe(false)
    act(() => { void controller.enter() }); act(() => root!.render(<Driver conversationId="other" />))
    await act(async () => resolve(history())); expect(controller.active).toBe(false)
  })
  it("keeps loaded messages shareable on history failure but does not falsely select all", async () => {
    bridge.getTimeline.mockRejectedValue(new Error("synthetic unavailable")); mount()
    await act(async () => controller.enter("m2"))
    expect(controller.complete).toBe(false); expect(controller.error).toBeTruthy()
    act(() => controller.preset("all")); expect([...controller.selected]).toEqual(["m2"])
    await act(() => controller.openPreview()); expect(controller.preview?.[0]?.id).toBe("m2")
  })
  it("keeps live IDs selected when persisted IDs differ and freezes later messages out", async () => {
    const live = [{ ...items[0]!, id: "local:question", historyIndex: undefined, timestamp: "2026-10-24T01:00:00Z" }, { ...items[1]!, id: "event:answer", historyIndex: undefined, timestamp: "2026-10-24T01:01:00Z" }]
    const persisted = [{ ...items[0]!, id: "c:history:0" }, { ...items[1]!, id: "c:history:1" }, { ...live[0]!, id: "c:history:2", historyIndex: 2 }, { ...live[1]!, id: "c:history:3", historyIndex: 3 }, { ...items[2]!, id: "c:history:4", historyIndex: 4, timestamp: "2026-10-24T01:02:00Z" }]
    bridge.getTimeline.mockResolvedValue({ ...history(), entries: persisted, total: 5 })
    mount(); act(() => root!.render(<Driver timeline={live} />))
    await act(() => controller.enter("event:answer"))
    expect(controller.messages.map((item) => item.id)).toEqual(["c:history:0", "c:history:1", "local:question", "event:answer"])
    expect([...controller.selected]).toEqual(["event:answer"])
    await act(() => controller.openPreview()); expect(controller.preview?.map((item) => item.id)).toEqual(["event:answer"])
    act(() => controller.exit()); expect(controller.items.map((item) => item.id)).toEqual(["c:history:0", "c:history:1", "local:question", "event:answer"])
    act(() => root!.render(<Driver timeline={persisted} />))
    expect(controller.items.map((item) => item.id)).toEqual(persisted.map((item) => item.id))
  })
  it("retains an indexed history tail followed by live IDs and selects the latest completed round", async () => {
    const live = [...items.slice(0, 2), { ...items[2]!, id: "local:pending", historyIndex: undefined }, { ...items[3]!, id: "event:stream", historyIndex: undefined, streaming: true }]
    bridge.getTimeline.mockResolvedValue({ ...history(), entries: [...items, { ...items[3]!, id: "after-enter", historyIndex: 4 }] })
    mount(); act(() => root!.render(<Driver timeline={live} sending />))
    await act(() => controller.enter("local:pending"))
    expect(controller.items.map((item) => item.id)).toEqual(live.map((item) => item.id))
    expect([...controller.selected]).toEqual(["local:pending"])
    expect(controller.messages.some((item) => item.id === "event:stream")).toBe(false)
    act(() => controller.preset("latest")); expect([...controller.selected]).toEqual(["m1", "m2"])
  })
})
