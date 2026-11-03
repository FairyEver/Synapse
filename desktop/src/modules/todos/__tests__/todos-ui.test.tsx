/** @vitest-environment jsdom */
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mocks, mount, flush, item, deferred } from "./harness"
import { TodosModule } from "../index"
import { EmbeddedSystemAppShell } from "../../apps/components/embedded-system-app-shell"
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock("../todo-image-files", async (original) => ({
  ...await original<typeof import("../todo-image-files")>(),
  prepareTodoImage: async (imageId: string) => ({ imageId, original: new Uint8Array([1]), thumbnail: new Uint8Array([2]) }),
}))
afterEach(() => window.getSelection()?.removeAllRanges())

function selectText(start: Node, end: Node = start) {
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.textContent!.length)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

describe("Todo visible actions", () => {
  it("shows a solid priority selection and saves chosen and pasted images with the quick-add draft", async () => {
    const createObjectURL = vi.fn(() => "blob:todo-test")
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = vi.fn()
    })
    try {
      mocks.stageImage.mockImplementation(async input => ({ imageId: input.imageId }))
      mocks.create.mockImplementation(async input => {
        const created = { ...item, id: "with-images", title: input.title, imageIds: input.imageIds }
        mocks.list.mockResolvedValue({ items: [created], nextOffset: null })
        return created
      })
      mocks.readImage.mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: "image/webp" })
      mount(<TodosModule />); await flush()
      const filter = document.querySelector('[role="radio"][aria-checked="true"]')!
      expect(filter.textContent).toBe("全部优先级")
      expect(filter.classList.contains("data-[state=on]:bg-primary")).toBe(true)
      const form = document.querySelector<HTMLFormElement>('[aria-label="快速新建待办"]')!
      const input = form.querySelector<HTMLInputElement>('input[aria-label="待办标题"]')!
      const picker = form.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = new File(["image"], "fixture.png", { type: "image/png" })
      const paste = new Event("paste", { bubbles: true, cancelable: true })
      Object.defineProperty(paste, "clipboardData", { value: { files: [file], items: [] } })
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "带图片的待办")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        Object.defineProperty(picker, "files", { value: [file] })
        picker.dispatchEvent(new Event("change", { bubbles: true }))
      })
      act(() => input.dispatchEvent(paste)); await flush()
      expect(paste.defaultPrevented).toBe(true)
      expect(form.querySelectorAll('button[aria-label^="预览图片"]')).toHaveLength(2)
      expect(mocks.stageImage).not.toHaveBeenCalled()
      act(() => form.requestSubmit()); await flush()
      expect(mocks.stageImage).toHaveBeenCalledTimes(2)
      expect(mocks.create.mock.calls[0]?.[0].imageIds).toEqual(mocks.stageImage.mock.calls.map(([arg]) => arg.imageId))
      const preview = document.querySelector<HTMLButtonElement>('li [aria-label="预览图片 1"]')!
      act(() => preview.click()); await flush()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("图片预览")
      expect(mocks.readImage).toHaveBeenCalledWith(expect.objectContaining({ todoId: "with-images", variant: "original" }))
      expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    } finally {
      mount(null)
      vi.unstubAllGlobals()
    }
  })
  it("adds from the top form without a dialog and keeps the draft when filtering", async () => {
    mocks.create.mockResolvedValue({ ...item, id: "created", title: "测试快建" })
    mount(<TodosModule />); await flush()
    const form = document.querySelector<HTMLFormElement>('form[aria-label="快速新建待办"]')!
    expect(form).not.toBeNull()
    const title = form.querySelector<HTMLInputElement>('input[aria-label="待办标题"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "测试快建")
      title.dispatchEvent(new Event("input", { bubbles: true }))
      document.querySelector<HTMLButtonElement>('[aria-label="筛选高优先级"]')!.click()
    })
    await flush()
    expect(title.value).toBe("测试快建")
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ priority: "high", offset: 0 }))
    act(() => form.requestSubmit()); await flush()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ title: "测试快建" })
    expect(mocks.create.mock.calls[0]?.[0]).not.toHaveProperty("priority")
    expect(title.value).toBe("")
    expect(document.activeElement).toBe(title)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("sets and clears a row priority through the versioned update", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...item, priority: "medium" }], nextOffset: null })
    const cleared = { ...item, priority: null, version: 2 }
    mocks.update.mockResolvedValue(cleared)
    mount(<TodosModule />); await flush()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="报销的优先级：中"]')!
    expect(trigger.textContent).toBe("中")
    expect(trigger.querySelector("svg")).toBeNull()
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush()
    const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((entry) => entry.textContent === "未设置")!
    mocks.list.mockResolvedValue({ items: [cleared], nextOffset: null })
    act(() => choice.click()); await flush()
    expect(mocks.update).toHaveBeenCalledWith("a", expect.objectContaining({ priority: null, expectedVersion: 1 }))
    expect(document.querySelector('[aria-label="报销的优先级：未设置"]')?.textContent).toBe("未设置")
  })

  it.each(["window", "dock", "launcher"] as const)("opens read-only details in %s with the complete note and edits only on request", async (host) => {
    const note = "背景：升级评估已完成\n验收：核对所有业务入口"
    mocks.list.mockResolvedValue({ items: [{ ...item, note, dueAt: "2026-11-01T08:00:00.000Z", remindAt: "2026-11-01T07:00:00.000Z", reminder: "before_due", offsetMinutes: 60, reminderStatus: "pending" }], nextOffset: null })
    mount(host === "window" ? <TodosModule /> : <EmbeddedSystemAppShell appName="待办事项" mode={host}><TodosModule /></EmbeddedSystemAppShell>); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!.click()); await flush()
    const sheet = document.querySelector('[data-slot="sheet-content"]')!
    expect(sheet).not.toBeNull()
    expect(sheet.getAttribute("data-side")).toBe("right")
    expect(sheet.textContent).toContain(note)
    expect(sheet.textContent).toContain("截止时间")
    expect(sheet.textContent).toContain("提醒时间")
    expect(sheet.querySelector("input,textarea,form")).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.setCompleted).not.toHaveBeenCalled()
    act(() => [...sheet.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "编辑")!.click()); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe("报销")
    expect(document.querySelector<HTMLTextAreaElement>('#todo-note')?.value).toBe(note)
  })

  it("opens completed notification targets as details and closes with Escape", async () => {
    mocks.get.mockResolvedValue({ ...item, id: "beyond-page", completedAt: item.createdAt, reminderStatus: "cancelled" })
    mount(<TodosModule openRequest={{ requestId: "completed-target", id: "beyond-page" }} />); await flush()
    const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!
    expect(sheet.textContent).toContain("已完成")
    expect(sheet.textContent).toContain("完成时间")
    expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("全部")
    expect(document.querySelector('#todo-title')).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.setCompleted).not.toHaveBeenCalled()
    act(() => sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })

  it("refreshes visible details without opening an editor and permits reading offline", async () => {
    mount(<TodosModule />); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!.click()); await flush()
    mocks.list.mockResolvedValue({ items: [{ ...item, title: "更新后的报销", version: 2 }], nextOffset: null })
    act(() => mocks.changed()); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')?.textContent).toContain("更新后的报销")
    mocks.online = false
    mount(<TodosModule />); await flush()
    const sheet = document.querySelector('[data-slot="sheet-content"]')!
    expect(sheet.textContent).toContain("更新后的报销")
    expect([...sheet.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "编辑")?.disabled).toBe(true)
    expect(document.querySelector('#todo-title')).toBeNull()
    act(() => sheet.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!.click()); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })

  it("keeps the menu edit action as a direct editor entry", async () => {
    mount(<TodosModule />); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="报销的操作"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush()
    act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry => entry.textContent === "编辑")!.click()); await flush()
    expect(document.querySelector<HTMLInputElement>('#todo-title')?.value).toBe("报销")
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })

  it("closes details on identity reset", async () => {
    mount(<TodosModule />); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!.click()); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull()
    act(() => mocks.reset()); await flush()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })

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
    const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) => entry.textContent === (completed ? "恢复为待办" : "完成"))
    expect(action).toBeDefined()
    mocks.setCompleted.mockResolvedValueOnce({ ...initial, completedAt: completed ? null : item.createdAt, version: 2 })
    mocks.list.mockResolvedValue({ items: completed ? [{ ...initial, completedAt: null, version: 2 }] : [], nextOffset: null })
    act(() => action!.click()); await flush()
    expect(mocks.setCompleted).toHaveBeenCalledWith("a", expect.objectContaining({ completed: !completed, expectedVersion: 1 }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it("preserves selected title and note text without opening details, then allows a normal click", async () => {
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
    expect(document.querySelector('[data-slot="sheet-content"]')?.textContent).toContain("报销")
    expect(document.querySelector('#todo-title')).toBeNull()
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
    expect(document.querySelector('[data-slot="sheet-content"]')?.textContent).toContain(title)
    expect(document.querySelector('#todo-title')).toBeNull()
  })

  it("preserves an edited dialog when a new target arrives and opens it after cancellation", async () => {
    const consumed = vi.fn()
    mount(<TodosModule onOpenRequestConsumed={consumed} />); await flush()
    act(() => document.querySelector<HTMLButtonElement>('[data-track="todos.open"]')!.click())
    await flush()
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="sheet-content"] button')].find(button => button.textContent === "编辑")!.click())
    await flush()
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
    expect(document.querySelector('[data-slot="sheet-content"]')?.textContent).toContain("另一事项")
    expect(document.querySelector('#todo-title')).toBeNull()
    expect(consumed).toHaveBeenCalledWith("new-target")
  })
  it("completes from the row and restores from the completed item's menu", async () => {
    mount(<TodosModule />); await flush()
    expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["未完成", "全部"])
    expect(document.querySelector('aside,input[type="search"]')).toBeNull()
    const done = deferred<typeof item>(); mocks.setCompleted.mockReturnValueOnce(done.promise)
    const row = document.querySelector("li")!
    expect(row.querySelector('[role="checkbox"]')).toBeNull()
    const control = row.querySelector<HTMLButtonElement>('[aria-label="标为完成：报销"]')!
    expect(control.textContent).toBe("完成")
    expect(control.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(row.querySelector('[data-track="todos.open"]')!.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    act(() => control.click()); expect(document.body.textContent).toContain("报销")
    expect(control.disabled).toBe(true)
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    mocks.list.mockResolvedValue({ items: [], nextOffset: null })
    await act(async () => { done.resolve({ ...item, version: 2, completedAt: item.createdAt }); await done.promise })
    await flush(); expect(document.querySelector('[aria-label="标为完成：报销"]')).toBeNull()
    expect(mocks.setCompleted).toHaveBeenCalledTimes(1)
    const completed = { ...item, completedAt: item.createdAt, version: 2 }
    mocks.list.mockResolvedValue({ items: [completed], nextOffset: null })
    act(() => document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))); await flush()
    const menuTrigger = document.querySelector<HTMLButtonElement>('[aria-label="报销的操作"]')!
    expect(menuTrigger.closest("li")?.querySelector('button[data-track="todos.complete"]')).toBeNull()
    act(() => menuTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush()
    const restore = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry => entry.textContent === "恢复为待办")!
    expect(restore).toBeDefined()
    const restored = { ...item, version: 3 }
    mocks.setCompleted.mockResolvedValueOnce(restored)
    mocks.list.mockResolvedValue({ items: [restored], nextOffset: null })
    act(() => restore.click()); await flush()
    expect(mocks.setCompleted).toHaveBeenLastCalledWith(item.id, expect.objectContaining({ completed: false, expectedVersion: 2 }))
    expect(document.querySelector('[aria-label="标为完成：报销"]')).not.toBeNull()
  })
})
