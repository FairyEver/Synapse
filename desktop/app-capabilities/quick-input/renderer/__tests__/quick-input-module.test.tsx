/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const quickInputFixtures = vi.hoisted(() => ({
  items: [
    {
      id: "quick-1",
      schemaVersion: 1,
      content: "今天的工作计划有什么",
      sortOrder: 10,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    },
  ],
}))

const quickInputBridge = vi.hoisted(() => ({
  item: {
    list: vi.fn(async () => quickInputFixtures.items),
    create: vi.fn(async (input: { content: string }) => ({
      id: "quick-2",
      schemaVersion: 1,
      content: input.content,
      sortOrder: 20,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    })),
    update: vi.fn(async (input: { id: string; content: string }) => ({
      id: input.id,
      schemaVersion: 1,
      content: input.content,
      sortOrder: 10,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    })),
    delete: vi.fn(async () => undefined),
    onChanged: vi.fn(() => vi.fn()),
  },
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "quickInput") return quickInputBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast }))

import { QuickInputModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  quickInputBridge.item.list.mockClear()
  quickInputBridge.item.list.mockImplementation(async () => quickInputFixtures.items)
  quickInputBridge.item.create.mockClear()
  quickInputBridge.item.update.mockClear()
  quickInputBridge.item.delete.mockClear()
  quickInputBridge.item.onChanged.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("QuickInputModule", () => {
  it("loads quick input items", async () => {
    await renderModule()

    expect(quickInputBridge.item.list).toHaveBeenCalled()
    expect(document.body.textContent).toContain("内容")
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).toContain("今天的工作计划有什么")
  })

  it("shows an empty state when no quick input items exist", async () => {
    quickInputBridge.item.list.mockResolvedValueOnce([])

    await renderModule()

    expect(document.body.textContent).toContain("暂无快捷输入")
    expect(Array.from(document.body.querySelectorAll("button")).some((button) => button.textContent === "新增快捷输入"))
      .toBe(true)
  })

  it("shows a retry action when loading quick input items fails", async () => {
    quickInputBridge.item.list
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce(quickInputFixtures.items)

    await renderModule()

    expect(document.body.textContent).toContain("加载失败")
    await clickButton("重试")

    expect(quickInputBridge.item.list).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("今天的工作计划有什么")
  })

  it("creates a quick input item", async () => {
    await renderModule()

    await clickButton("新增")
    await changeTextarea("预览今天的工作总结")
    await clickButton("保存快捷输入")

    expect(quickInputBridge.item.create).toHaveBeenCalledWith({ content: "预览今天的工作总结" })
    expect(toast.success).toHaveBeenCalledWith("已保存")
  })

  it("updates and deletes an item", async () => {
    await renderModule()

    await clickButton("编辑快捷输入：今天的工作计划有什么")
    await changeTextarea("更新后的快捷输入")
    await clickButton("保存快捷输入")
    await clickButton("删除快捷输入：更新后的快捷输入")

    expect(quickInputBridge.item.update).toHaveBeenCalledWith({
      id: "quick-1",
      content: "更新后的快捷输入",
    })
    expect(quickInputBridge.item.delete).toHaveBeenCalledWith({ id: "quick-1" })
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<QuickInputModule />)
    await Promise.resolve()
  })
}

async function clickButton(text: string, index = 0): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((button) => button.textContent === text || button.getAttribute("aria-label") === text)
  await act(async () => {
    buttons[index]?.click()
    await Promise.resolve()
  })
}

async function changeTextarea(value: string): Promise<void> {
  const textarea = document.body.querySelector("textarea")
  await act(async () => {
    if (!textarea) throw new Error("Textarea not found")
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    valueSetter?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}
