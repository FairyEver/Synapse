/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, it, expect, vi } from "vitest"
import type { DriveBrowsingHistoryPageDto } from "@synapse/shared"
import { useDriveBrowsingHistory } from "../use-drive-browsing-history"
const mocks = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), open: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({ drive: { browsingHistory: { list: mocks.list, clear: mocks.clear } }, shell: { openExternal: mocks.open } }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let state: ReturnType<typeof useDriveBrowsingHistory>
let props = { accountId: "a" as string | null, open: true }
function Probe() { state = useDriveBrowsingHistory(props); return null }
const page = (id: string, nextCursor: string | null = null): DriveBrowsingHistoryPageDto => ({ items: [{ id, title: id, author: "author", kind: "web", url: "https://example.com/share", visitedAt: "2026-10-28T00:00:00Z" }], nextCursor })
async function change(fn: () => void) { await act(async () => { fn() }) }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
beforeEach(async () => { vi.useFakeTimers(); vi.resetAllMocks(); mocks.list.mockResolvedValue(page("first", "next")); mocks.clear.mockResolvedValue({ ok: true }); props = { accountId: "a", open: true }; root = createRoot(document.createElement("div")); await change(() => root.render(<Probe />)); await tick() })
afterEach(async () => { await change(() => root.unmount()); vi.useRealTimers() })
it("debounces unified search, selects a kind, paginates and opens through the controlled browser bridge", async () => {
  await change(() => { state.setQuery("title author"); state.setKind("document") }); expect(mocks.list).toHaveBeenCalledTimes(1)
  await tick(); expect(mocks.list).toHaveBeenLastCalledWith({ query: "title author", kind: "document", limit: 50 })
  mocks.list.mockResolvedValueOnce(page("second")); await act(async () => { await state.loadMore() })
  expect(mocks.list).toHaveBeenLastCalledWith({ query: "title author", kind: "document", limit: 50, cursor: "next" }); expect(state.items.map(x => x.id)).toEqual(["first", "second"])
  await act(async () => { await state.openEntry(state.items[1]) }); expect(mocks.open).toHaveBeenCalledWith("https://example.com/share")
})
it("discards late searches and account results, and starts fresh after close", async () => {
  let old!: (p: DriveBrowsingHistoryPageDto) => void
  mocks.list.mockReturnValueOnce(new Promise(resolve => { old = resolve }))
  await change(() => state.setQuery("private")); await tick()
  props = { ...props, accountId: "b" }; await change(() => root.render(<Probe />)); expect(state.items).toEqual([]); expect(state.query).toBe("")
  await change(() => old(page("private"))); await tick(); expect(state.items[0].id).toBe("first")
  props = { ...props, open: false }; await change(() => root.render(<Probe />)); expect(state.items).toEqual([])
  props = { ...props, open: true }; await change(() => root.render(<Probe />)); expect(state.items).toEqual([]); await tick()
})
it("invalidates in-flight pages before clearing and blocks repeated clears", async () => {
  let list!: (p: DriveBrowsingHistoryPageDto) => void; let clear!: (p: { ok: true }) => void
  mocks.list.mockReturnValueOnce(new Promise(resolve => { list = resolve })); mocks.clear.mockReturnValueOnce(new Promise(resolve => { clear = resolve }))
  let pending!: Promise<void>; await change(() => { void state.loadMore() }); await change(() => { pending = state.clearAll(); void state.clearAll() })
  expect(mocks.clear).toHaveBeenCalledTimes(1); await change(() => list(page("stale")))
  await act(async () => { clear({ ok: true }); await pending }); expect(state.items).toEqual([])
})
it("preserves rows and criteria when clearing fails, then retries the same search", async () => {
  await change(() => state.setQuery("author")); await tick(); mocks.clear.mockRejectedValueOnce(new Error("clear failed"))
  await act(async () => { await state.clearAll() }); expect(state.items[0].id).toBe("first"); expect(state.query).toBe("author"); expect(state.error).toBe("clear failed")
  await act(async () => { await state.retry() }); expect(state.error).toBeNull()
})

it("ignores a late browser failure after the account changes", async () => {
  let reject!: (cause: Error) => void
  mocks.open.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  let pending!: Promise<void>; await change(() => { pending = state.openEntry(state.items[0]) })
  props = { ...props, accountId: "b" }; await change(() => root.render(<Probe />)); await tick()
  await act(async () => { reject(new Error("old account link failed")); await pending }); expect(state.error).toBeNull()
})
it("shows a retryable error if criteria change while a pending clear fails", async () => {
  let reject!: (cause: Error) => void
  mocks.clear.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  let pending!: Promise<void>; await change(() => { pending = state.clearAll() })
  await change(() => { state.setQuery("new criteria"); state.setKind("document") }); await tick()
  await act(async () => { reject(new Error("clear unavailable")); await pending })
  expect(state.loading).toBe(false); expect(state.error).toBe("clear unavailable"); expect(state.query).toBe("new criteria"); expect(state.items).toEqual([])
  await act(async () => { await state.retry() })
  expect(mocks.list).toHaveBeenLastCalledWith({ query: "new criteria", kind: "document", limit: 50 }); expect(state.error).toBeNull(); expect(state.items[0].id).toBe("first")
})
it("refreshes a reopened history after its pending clear completes", async () => {
  let finish!: (value: { ok: true }) => void
  mocks.clear.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  let pending!: Promise<void>; await change(() => { pending = state.clearAll() })
  props = { ...props, open: false }; await change(() => root.render(<Probe />))
  props = { ...props, open: true }; await change(() => root.render(<Probe />)); await tick()
  expect(state.items[0].id).toBe("first")
  mocks.list.mockResolvedValueOnce({ items: [], nextCursor: null })
  await act(async () => { finish({ ok: true }); await pending })
  expect(state.items).toEqual([]); expect(mocks.list).toHaveBeenCalledTimes(3)
})
it("does not refresh another account when an earlier clear completes", async () => {
  let finish!: (value: { ok: true }) => void
  mocks.clear.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  let pending!: Promise<void>; await change(() => { pending = state.clearAll() })
  props = { ...props, accountId: "b" }; await change(() => root.render(<Probe />)); await tick()
  const calls = mocks.list.mock.calls.length
  await act(async () => { finish({ ok: true }); await pending })
  expect(state.items[0].id).toBe("first"); expect(mocks.list).toHaveBeenCalledTimes(calls)
})
