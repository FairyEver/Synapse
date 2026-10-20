/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveItemTreeListPageDto } from "@synapse/shared"
import { useDriveSearch, type DriveSearchController } from "../use-drive-search"

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({ drive: { itemTree: { list: mocks.list } } }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let controller: DriveSearchController
let props: Parameters<typeof useDriveSearch>[0]
function Probe() { controller = useDriveSearch(props); return null }
function page(ids: readonly string[], nextOffset: number | null = null): DriveItemTreeListPageDto {
  return { items: ids.map(id => ({ id, name: `${id}.md`, parentId: null, type: "file", size: "12", mimeType: "text/markdown", storageStatus: "active", shared: false, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", path: `${id}.md`, depth: 0, ancestors: [] })), total: 101, fileCount: 101, folderCount: 0, hasMore: nextOffset !== null, nextOffset }
}
async function change(action: () => void) { await act(async () => { action() }) }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
async function open(query: string) { await change(() => controller.start()); await change(() => controller.setDraft(query)); await tick() }
beforeEach(async () => {
  vi.useFakeTimers(); mocks.list.mockReset().mockResolvedValue(page(["found"]))
  props = { enabled: true, accountId: "account-1", parentId: null }
  root = createRoot(document.createElement("div")); await change(() => root.render(<Probe />))
})
afterEach(async () => { await change(() => root.unmount()); vi.useRealTimers() })

describe("useDriveSearch", () => {
  it("only searches after criteria are entered, with debounce and server pagination", async () => {
    await change(() => controller.start()); await tick(); expect(mocks.list).not.toHaveBeenCalled()
    await change(() => controller.setDraft("云盘")); expect(mocks.list).not.toHaveBeenCalled()
    await tick(); expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ query: "云盘", parentId: null, limit: 100, offset: 0 }))
    expect(controller.items[0].id).toBe("found")
  })
  it("does not submit IME intermediate text and preserves the last results", async () => {
    await open("old")
    await change(() => { controller.setComposing(true); controller.setDraft("云") }); await tick()
    expect(mocks.list).toHaveBeenCalledTimes(1); expect(controller.items[0].id).toBe("found")
    await change(() => controller.submit()); expect(mocks.list).toHaveBeenCalledTimes(1)
    await change(() => { controller.setDraft("云盘"); controller.setComposing(false) }); await tick()
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: "云盘" }))
  })
  it("ignores out-of-order requests and cancels visible updates after closing", async () => {
    let resolveOld!: (value: DriveItemTreeListPageDto) => void
    let resolveNew!: (value: DriveItemTreeListPageDto) => void
    mocks.list.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve }))
    await open("old"); await change(() => controller.setDraft("new")); await tick()
    await change(() => resolveNew(page(["new"]))); await change(() => resolveOld(page(["old"])))
    expect(controller.items.map(item => item.id)).toEqual(["new"])
    await change(() => { controller.setDraft("later"); controller.close() }); await tick()
    expect(controller.active).toBe(false); expect(controller.items).toEqual([])
  })
  it("clears query and recent history across accounts before old responses can appear", async () => {
    await open("private-name"); await change(() => controller.remember())
    expect(controller.history).toEqual(["private-name"])
    props = { ...props, accountId: "account-2" }; await change(() => root.render(<Probe />)); await tick()
    expect(controller.active).toBe(false); expect(controller.draft).toBe(""); expect(controller.history).toEqual([]); expect(controller.items).toEqual([])
  })
  it("combines folder scope and filters without requiring a keyword", async () => {
    props = { ...props, parentId: "folder-1" }; await change(() => root.render(<Probe />))
    await change(() => controller.start()); await change(() => { controller.updateFilter("scope", "folder"); controller.updateFilter("fileType", "image"); controller.updateFilter("days", "7") }); await tick()
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ parentId: "folder-1", fileType: "image", query: "", updatedAfter: expect.any(String) }))
    await change(() => controller.clearFilters()); await tick(); expect(controller.active).toBe(false)
  })
  it("loads subsequent pages with unchanged criteria and deduplicates overlapping rows", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `file-${index}`)
    mocks.list.mockResolvedValueOnce(page(ids, 100)).mockResolvedValueOnce(page(["file-99", "last"]))
    await open(".md"); await act(async () => { await controller.loadMore() })
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: ".md", offset: 100 }))
    expect(controller.items).toHaveLength(101); expect(controller.hasMore).toBe(false)
  })
  it("invalidates suspended results after mutations and restores the loaded range with the same conditions", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `old-${index}`)
    const fresh = Array.from({ length: 100 }, (_, index) => `fresh-${index}`)
    mocks.list.mockResolvedValueOnce(page(ids, 100)).mockResolvedValueOnce(page(["old-last"]))
      .mockResolvedValueOnce(page(fresh, 100)).mockResolvedValueOnce(page(["fresh-last"]))
    await open(".md"); await act(async () => { await controller.loadMore() })
    expect(controller.items).toHaveLength(101)
    await change(() => controller.suspend()); await act(async () => { await controller.refresh() })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    await change(() => controller.restore()); await tick()
    expect(mocks.list).toHaveBeenCalledTimes(4)
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: ".md", offset: 100, limit: 100 }))
    expect(controller.items).toHaveLength(101); expect(controller.items[0].id).toBe("fresh-0")
    expect(controller.items.at(-1)?.id).toBe("fresh-last")
  })

  it("preserves results and filters through suspension and supports failure retry", async () => {
    await open("云盘"); await change(() => controller.updateFilter("shareStatus", "shared")); await tick()
    const requests = mocks.list.mock.calls.length
    await change(() => controller.suspend()); expect(controller.suspended).toBe(true); expect(controller.active).toBe(false)
    await change(() => controller.restore()); await tick()
    expect(controller.draft).toBe("云盘"); expect(controller.filters.shareStatus).toBe("shared"); expect(mocks.list).toHaveBeenCalledTimes(requests)
    mocks.list.mockRejectedValueOnce(new Error("连接失败")); await act(async () => { await controller.refresh() })
    expect(controller.error).toBe("连接失败"); expect(controller.draft).toBe("云盘")
    await act(async () => { await controller.refresh() }); expect(controller.error).toBeNull(); expect(controller.items).toHaveLength(1)
  })
})
