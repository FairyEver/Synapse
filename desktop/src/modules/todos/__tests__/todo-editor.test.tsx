/** @vitest-environment jsdom */
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { mocks, mount, item, deferred } from "./harness"
import { useTodoEditor } from "../use-todo-editor"
let current: ReturnType<typeof useTodoEditor>
const saved = vi.fn(async () => {})
function Harness({ generation = 0 }: { generation?: number }) { current = useTodoEditor({ generation, online: mocks.online, onSaved: saved }); return null }
describe("Todo editor", () => {
  it.each(["close-and-open", "change"])("ignores a reload result after newer draft action: %s", async (action) => {
    mount(<Harness />); act(() => current.open(item))
    const response = deferred<typeof item>(); mocks.get.mockReturnValueOnce(response.promise)
    let loading!: Promise<void>
    act(() => { loading = current.reload() })
    act(() => { if (action === "close-and-open") { current.close(); current.open({ ...item, id: "other", title: "另一事项" }) }; current.change("title", "不能丢失的草稿") })
    await act(async () => { response.resolve({ ...item, title: "迟到的旧数据", version: 2 }); await loading })
    expect(current.draft?.title).toBe("不能丢失的草稿")
    expect(current.draft?.id).toBe(action === "close-and-open" ? "other" : item.id)
  })
  it("preserves both original UTC instants when saving a title in a DST fold", async () => {
    vi.stubEnv("TZ", "America/New_York")
    try {
      const original = { ...item, dueAt: "2026-11-01T06:30:00.000Z", reminder: "custom" as const, remindAt: "2026-11-01T06:45:00.000Z" }
      mount(<Harness />); act(() => current.open(original))
      act(() => { current.change("title", "只改标题"); current.change("note", "只改备注") })
      mocks.update.mockResolvedValue({ ...original, version: 2 })
      await act(async () => { await current.save() })
      expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ title: "只改标题", note: "只改备注", dueAt: original.dueAt, remindAt: original.remindAt })
    } finally { vi.unstubAllEnvs() }
  })
  it.each([400, 409, 0])("keeps draft and UUID after failure %s", async (status) => {
    mount(<Harness />); act(() => { current.open(item); current.change("title", "已编辑") })
    mocks.update.mockRejectedValue(Object.assign(new Error("失败"), { status, code: status === 409 ? "TODO_VERSION_CONFLICT" : "TODO_NETWORK_ERROR" }))
    await act(async () => { await current.save(); await current.save() })
    expect(current.draft?.title).toBe("已编辑")
    expect(mocks.update.mock.calls[0]?.[1].clientRequestId).toBe(mocks.update.mock.calls[1]?.[1].clientRequestId)
    expect(mocks.update.mock.calls[1]?.[1].expectedVersion).toBe(1)
    mount(<Harness generation={1} />); expect(current.draft).toBeNull()
  })
  it("prevents duplicate submission and clears late saved result after reset", async () => {
    mount(<Harness />); act(() => current.open())
    act(() => current.change("title", "新事项"))
    const response = deferred<typeof item>(); mocks.create.mockReturnValue(response.promise)
    let writing!: Promise<void>
    act(() => { writing = current.save(); void current.save() })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    mount(<Harness generation={1} />)
    await act(async () => { response.resolve(item); await writing })
    expect(current.draft).toBeNull()
  })
})
