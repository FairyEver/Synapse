/** @vitest-environment jsdom */
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { mocks, mount, flush, item, deferred } from "./harness"
import { useTodoTarget } from "../use-todo-target"
const open = vi.fn(), selectAll = vi.fn(), consumed = vi.fn()
let current: ReturnType<typeof useTodoTarget>
function Harness({ ready = true, generation = 0, id = "beyond-page" }: { ready?: boolean; generation?: number; id?: string }) { current = useTodoTarget({ request: { requestId: id, id }, ready, generation, open, selectAll, consumed }); return null }
describe("Todo targets", () => {
  it("retries a failed owned target without any mutation", async () => {
    open.mockClear(); mocks.get.mockRejectedValueOnce(new Error("连接失败"))
    mount(<Harness />); await flush(); expect(current.error).toBe("连接失败")
    await act(async () => { await current.retry() })
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(open).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("waits for login then reads a completed target directly beyond the list page", async () => {
    open.mockClear(); selectAll.mockClear(); mount(<Harness ready={false} />); await flush(); expect(mocks.get).not.toHaveBeenCalled()
    mocks.get.mockResolvedValue({ ...item, id: "beyond-page", completedAt: item.createdAt })
    mount(<Harness />); await flush()
    expect(mocks.get).toHaveBeenCalledWith({ id: "beyond-page" }); expect(open).toHaveBeenCalled(); expect(selectAll).toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.setCompleted).not.toHaveBeenCalled()
  })
  it.each(["navigation", "identity"])("cancels late target after %s", async (reason) => {
    open.mockClear(); const result = deferred<typeof item>(); mocks.get.mockReturnValueOnce(result.promise)
    mount(<Harness />); await flush()
    if (reason === "navigation") act(() => current.cancel()); else mount(<Harness generation={1} />)
    await act(async () => { result.resolve(item); await result.promise })
    expect(open).not.toHaveBeenCalled()
  })
})
