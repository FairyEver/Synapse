/** @vitest-environment jsdom */
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { mocks, mount, item, deferred } from "./harness"
import { useTodoEditor } from "../use-todo-editor"
let current: ReturnType<typeof useTodoEditor>
const saved = vi.fn(async () => {})
function Harness({ generation = 0 }: { generation?: number }) { current = useTodoEditor({ generation, online: mocks.online, onSaved: saved }); return null }
describe("Todo editor", () => {
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
