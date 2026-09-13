/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_CONTENT_PREVIOUS_CURSOR_LIMIT, useAgentLongContent } from "../use-agent-long-content"

const getChunk = vi.hoisted(() => vi.fn())
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ getTimelineContentChunk: getChunk }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let viewer: ReturnType<typeof useAgentLongContent>
function Driver({ conversationId = "c" }: { conversationId?: string }) {
  viewer = useAgentLongContent({ projectId: "p", conversationId, historyIndex: 0 })
  return null
}
function mount() {
  root = createRoot(document.createElement("div"))
  act(() => root!.render(<Driver />))
}
function chunk(offset = 0) {
  return { content: `synthetic-${offset}`, nextOffset: offset + 1, done: false }
}
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  vi.clearAllMocks()
})

describe("Agent full content lifecycle", () => {
  it("keeps only bounded backwards cursors and can still return to the beginning", async () => {
    getChunk.mockImplementation(async ({ offset }: { offset: number }) => chunk(offset))
    mount()
    await act(async () => viewer.onOpenChange(true))
    for (let index = 0; index < 400; index += 1) await act(() => viewer.next())
    expect(viewer.content).toBe("synthetic-400")
    for (let index = 0; index < AGENT_CONTENT_PREVIOUS_CURSOR_LIMIT; index += 1) await act(() => viewer.previous())
    expect(viewer.previousLabel).toBe("返回开头")
    await act(() => viewer.previous())
    expect(viewer.content).toBe("synthetic-0")
    expect(viewer.canGoPrevious).toBe(false)
  })

  it("releases content after 300 open/close cycles", async () => {
    getChunk.mockResolvedValue(chunk())
    mount()
    for (let index = 0; index < 300; index += 1) {
      await act(async () => viewer.onOpenChange(true))
      expect(viewer.content).toBe("synthetic-0")
      act(() => viewer.onOpenChange(false))
      expect(viewer.content).toBe("")
      expect(viewer.loading).toBe(false)
      expect(viewer.canGoPrevious).toBe(false)
    }
  })

  it("ignores old responses after closing and switching conversations", async () => {
    let resolveOld!: (value: ReturnType<typeof chunk>) => void
    getChunk.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    mount()
    act(() => viewer.onOpenChange(true))
    act(() => viewer.onOpenChange(false))
    act(() => root!.render(<Driver conversationId="new" />))
    getChunk.mockResolvedValueOnce({ ...chunk(), content: "new" })
    await act(async () => viewer.onOpenChange(true))
    await act(async () => resolveOld({ ...chunk(), content: "stale" }))
    expect(viewer.content).toBe("new")
    expect(viewer.loading).toBe(false)
  })

  it("serializes double clicks and retries the failed cursor without losing the current page", async () => {
    getChunk.mockResolvedValueOnce(chunk())
    mount()
    await act(async () => { viewer.onOpenChange(true); viewer.onOpenChange(true) })
    expect(getChunk).toHaveBeenCalledTimes(1)
    getChunk.mockRejectedValueOnce(new Error("synthetic failure"))
    await act(() => viewer.next())
    expect(viewer.content).toBe("synthetic-0")
    expect(viewer.error).toBe("加载失败，请重试")
    getChunk.mockResolvedValueOnce(chunk(1))
    await act(() => viewer.retry())
    expect(getChunk).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }))
    expect(viewer.content).toBe("synthetic-1")
    expect(viewer.error).toBeNull()
  })
})
