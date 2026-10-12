/** @vitest-environment jsdom */
import { act } from "react"
import { describe, expect, it } from "vitest"
import { mocks, mount, flush, item, deferred } from "./harness"
import { useTodos } from "../use-todos"
let current: ReturnType<typeof useTodos>
function Harness() { current = useTodos(); return null }
describe("cloud Todo list", () => {
  it("defaults pending and removes only after completion succeeds, then restores in all", async () => {
    mount(<Harness />); await flush()
    expect(current.filter).toBe("pending")
    const response = deferred<typeof item>()
    mocks.setCompleted.mockReturnValueOnce(response.promise)
    let writing!: Promise<typeof item>
    act(() => { writing = current.setCompleted(item, true) })
    expect(current.items).toHaveLength(1)
    const done = { ...item, version: 2, completedAt: item.createdAt }
    mocks.list.mockResolvedValue({ items: [], nextOffset: null })
    await act(async () => { response.resolve(done); await writing })
    expect(current.items).toHaveLength(0)
    expect(mocks.setCompleted).toHaveBeenCalledTimes(1)
    mocks.list.mockResolvedValue({ items: [done], nextOffset: null })
    act(() => current.setFilter("all")); await flush()
    mocks.setCompleted.mockResolvedValue({ ...item, version: 3 }); mocks.list.mockResolvedValue({ items: [{ ...item, version: 3 }], nextOffset: null })
    await act(async () => { await current.setCompleted(done, false) })
    expect(current.items[0]?.completedAt).toBeNull()
  })
  it("merges pages by highest version and preserves items after refresh failure", async () => {
    mocks.list.mockResolvedValueOnce({ items: [{ ...item, version: 3 }], nextOffset: 50 }).mockResolvedValueOnce({ items: [{ ...item, version: 2 }], nextOffset: null })
    mount(<Harness />); await flush(); await act(async () => { await current.loadMore() })
    expect(current.items.map((entry) => entry.version)).toEqual([3])
    mocks.list.mockRejectedValueOnce(new Error("网络中断"))
    await act(async () => { await current.refresh() })
    expect(current.items).toHaveLength(1); expect(current.error).toBe("网络中断")
    mocks.list.mockResolvedValue({ items: [item], nextOffset: null }); act(() => mocks.changed()); await flush()
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "pending", offset: 0, limit: 50 })
  })
  it("does not resurrect a removed row from an old completion receipt when refresh fails", async () => {
    const completed = { ...item, version: 2, completedAt: item.createdAt }
    mount(<Harness />); await flush()
    mocks.list.mockResolvedValue({ items: [completed], nextOffset: null })
    act(() => current.setFilter("all")); await flush()
    const receipt = deferred<typeof item>()
    mocks.setCompleted.mockReturnValueOnce(receipt.promise)
    let writing!: Promise<typeof item>
    act(() => { writing = current.setCompleted(completed, false) })
    mocks.list.mockResolvedValue({ items: [], nextOffset: null })
    await act(async () => { await current.refresh() })
    expect(current.items).toEqual([])
    mocks.list.mockRejectedValueOnce(new Error("网络中断"))
    await act(async () => { receipt.resolve({ ...item, version: 3 }); await writing })
    expect(current.items).toEqual([])
    expect(current.error).toBe("网络中断")
  })
  it("rejects late pending pages and same-account identity reset results", async () => {
    const old = deferred<{ items: typeof item[]; nextOffset: null }>(); mocks.list.mockReturnValueOnce(old.promise)
    mount(<Harness />); act(() => current.setFilter("all")); await flush()
    await act(async () => { old.resolve({ items: [{ ...item, id: "old" }], nextOffset: null }); await old.promise })
    expect(current.items.map((entry) => entry.id)).toEqual(["a"])
    const pending = deferred<{ items: typeof item[]; nextOffset: null }>(); mocks.list.mockReturnValueOnce(pending.promise)
    act(() => { void current.refresh() }); act(() => mocks.reset())
    await act(async () => { pending.resolve({ items: [item], nextOffset: null }); await pending.promise })
    expect(current.items).toEqual([])
  })
  it("undo keeps receipt version on another-client conflict and rereads without overwriting", async () => {
    mount(<Harness />); await flush()
    const done = { ...item, version: 2, completedAt: item.createdAt }
    mocks.setCompleted.mockResolvedValueOnce(done); mocks.list.mockResolvedValue({ items: [], nextOffset: null })
    await act(async () => { await current.setCompleted(item, true) })
    mocks.setCompleted.mockRejectedValueOnce(Object.assign(new Error("冲突"), { code: "TODO_VERSION_CONFLICT" }))
    mocks.list.mockResolvedValue({ items: [{ ...done, version: 3 }], nextOffset: null })
    await act(async () => { await expect(current.undoCompletion()).rejects.toMatchObject({ code: "TODO_VERSION_CONFLICT" }) })
    expect(mocks.setCompleted.mock.calls[1]?.[1]).toMatchObject({ completed: false, expectedVersion: 2 })
    expect(mocks.setCompleted).toHaveBeenCalledTimes(2)
  })
})
