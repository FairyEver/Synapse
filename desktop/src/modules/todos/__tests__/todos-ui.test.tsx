/** @vitest-environment jsdom */
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { mocks, mount, flush, item, deferred } from "./harness"
import { TodosModule } from "../index"
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
describe("Todo visible actions", () => {
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
