/** @vitest-environment jsdom */
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mocks, mount, flush, item, deferred } from "./harness"
import { TodosModule } from "../index"
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
afterEach(() => window.getSelection()?.removeAllRanges())

function selectText(start: Node, end: Node = start) {
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.textContent!.length)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

describe("Todo visible actions", () => {
  it.each([false, true])("offers the completion action in the menu for completed=%s", async (completed) => {
    const initial = { ...item, completedAt: completed ? item.createdAt : null }
    mocks.list.mockResolvedValue({ items: [initial], nextOffset: null })
    mount(<TodosModule />); await flush()
    if (completed) {
      act(() => document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
      await flush()
    }
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="报销的操作"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    await flush()
    const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) => entry.textContent === (completed ? "恢复" : "完成"))
    expect(action).toBeDefined()
    mocks.setCompleted.mockResolvedValueOnce({ ...initial, completedAt: completed ? null : item.createdAt, version: 2 })
    mocks.list.mockResolvedValue({ items: completed ? [{ ...initial, completedAt: null, version: 2 }] : [], nextOffset: null })
    act(() => action!.click()); await flush()
    expect(mocks.setCompleted).toHaveBeenCalledWith("a", expect.objectContaining({ completed: !completed, expectedVersion: 1 }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it("preserves selected title and note text without opening the editor, then allows a normal click", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...item, note: "保留收据" }], nextOffset: null })
    mount(<TodosModule />); await flush()
    const body = document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!
    selectText(body.children[0].firstChild!, body.children[1].firstChild!)
    act(() => body.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })))
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(window.getSelection()?.toString()).toBe("报销保留收据")

    window.getSelection()!.removeAllRanges()
    act(() => body.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })))
    await flush()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe("报销")
  })

  it("preserves a selection across todo rows without opening the row where the drag ends", async () => {
    mocks.list.mockResolvedValue({ items: [item, { ...item, id: "b", title: "合同" }], nextOffset: null })
    mount(<TodosModule />); await flush()
    const bodies = document.querySelectorAll<HTMLButtonElement>('[data-track="todos.open"]')
    selectText(bodies[0].children[0].firstChild!, bodies[1].children[0].firstChild!)
    act(() => bodies[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })))
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(window.getSelection()?.toString()).toContain("报销")
    expect(window.getSelection()?.toString()).toContain("合同")
  })

  it.each([{ target: 0, detail: 0, title: "报销" }, { target: 1, detail: 1, title: "合同" }])("allows activation of $title while text is selected with click detail $detail", async ({ target, detail, title }) => {
    mocks.list.mockResolvedValue({ items: [item, { ...item, id: "b", title: "合同" }], nextOffset: null })
    mount(<TodosModule />); await flush()
    const bodies = document.querySelectorAll<HTMLButtonElement>('[data-track="todos.open"]')
    selectText(bodies[0].children[0].firstChild!)
    act(() => bodies[target].dispatchEvent(new MouseEvent("click", { bubbles: true, detail })))
    await flush()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe(title)
  })

  it("preserves an edited dialog when a new target arrives and opens it after cancellation", async () => {
    const consumed = vi.fn()
    mount(<TodosModule onOpenRequestConsumed={consumed} />); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!.click())
    const input = document.querySelector<HTMLInputElement>('#todo-title')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "未保存的标题")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(input.value).toBe("未保存的标题")
    mocks.get.mockResolvedValue({ ...item, id: "other", title: "另一事项" })
    mount(<TodosModule openRequest={{ requestId: "new-target", id: "other" }} onOpenRequestConsumed={consumed} />); await flush()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe("未保存的标题")
    expect(mocks.get).not.toHaveBeenCalled(); expect(consumed).not.toHaveBeenCalled()
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "取消")!.click())
    await flush()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe("另一事项")
    expect(consumed).toHaveBeenCalledWith("new-target")
  })
  it("shows two tabs and a completion control, then hides only the successfully completed row", async () => {
    mount(<TodosModule />); await flush()
    expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["未完成", "全部"])
    expect(document.querySelector('aside,input[type="search"]')).toBeNull()
    const done = deferred<typeof item>(); mocks.setCompleted.mockReturnValueOnce(done.promise)
    const control = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!
    act(() => control.click()); expect(document.body.textContent).toContain("报销")
    mocks.list.mockResolvedValue({ items: [], nextOffset: null })
    await act(async () => { done.resolve({ ...item, version: 2, completedAt: item.createdAt }); await done.promise })
    await flush(); expect(document.querySelector('[role="checkbox"]')).toBeNull()
    expect(mocks.setCompleted).toHaveBeenCalledTimes(1)
    const completed = { ...item, completedAt: item.createdAt, version: 2 }
    mocks.list.mockResolvedValue({ items: [completed], nextOffset: null })
    act(() => document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))); await flush()
    expect(document.querySelector('[role="checkbox"]')?.getAttribute("aria-label")).toBe("恢复 报销")
  })
})
