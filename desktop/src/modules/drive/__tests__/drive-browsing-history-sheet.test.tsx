/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DriveBrowsingHistorySheet } from "../drive-browsing-history-sheet"
const mocks = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), open: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({ drive: { browsingHistory: { list: mocks.list, clear: mocks.clear } }, shell: { openExternal: mocks.open } }) }))
vi.mock("@/lib/ui-tracking", async (original) => ({ ...await original<typeof import("@/lib/ui-tracking")>(), track: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
async function click(text: string) { const button = [...document.querySelectorAll("button")].find(b => b.textContent === text); expect(button).toBeTruthy(); await act(async () => { button!.click() }) }
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索浏览历史"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  return input
}
beforeEach(async () => {
  vi.resetAllMocks(); vi.useFakeTimers(); mocks.list.mockResolvedValue({ items: [{ id: "one", title: "项目文档", author: "author", kind: "document", url: "https://example.com/share", visitedAt: new Date().toISOString() }], nextCursor: null }); mocks.clear.mockResolvedValue({ ok: true })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<DriveBrowsingHistorySheet open accountId="account" onOpenChange={vi.fn()} />) }); await act(async () => { await vi.advanceTimersByTimeAsync(260) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
it("opens the entire history row in the default browser and confirms before clearing", async () => {
  expect(document.body.textContent).toContain("今天"); expect(document.body.textContent).toContain("author")
  expect(document.body.textContent).not.toContain("https://example.com/share")
  const visitTime = document.querySelector('button[aria-label="打开 项目文档"] time')
  expect(visitTime?.textContent).toBe("刚刚")
  expect(visitTime?.getAttribute("aria-label")).toMatch(/^访问时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u)
  const row = document.querySelector<HTMLButtonElement>('button[aria-label="打开 项目文档"]')!
  await act(async () => row.click()); expect(mocks.open).toHaveBeenCalledWith("https://example.com/share")
  await click("清空历史"); expect(mocks.clear).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("清空全部浏览历史？")
  await click("取消"); expect(mocks.clear).not.toHaveBeenCalled()
  await click("清空历史"); await click("确认清空"); expect(mocks.clear).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain("暂无浏览历史")
})
it("offers exactly one unified search and one type selector", () => {
  expect(document.querySelectorAll('input[aria-label="搜索浏览历史"]')).toHaveLength(1)
  expect(document.querySelectorAll("select")).toHaveLength(1)
  expect(document.querySelector("select")?.textContent).toBe("全部类型网页文档文件夹其他")
})
it("clears only the search words, keeps the selected type and returns focus to the search", async () => {
  const select = document.querySelector("select")!
  await act(async () => { select.value = "document"; select.dispatchEvent(new Event("change", { bubbles: true })) })
  const input = await search("项目")
  const clear = document.querySelector<HTMLButtonElement>('button[aria-label="清除关键词"]')
  expect(clear).toBeTruthy()
  expect(document.querySelector("mark")?.textContent).toBe("项目")
  expect(document.querySelector('button[aria-label="打开 项目文档"] time')?.textContent).toBe("今天 刚刚")
  await act(async () => { clear!.click(); await vi.advanceTimersByTimeAsync(260) })
  expect(input.value).toBe(""); expect(select.value).toBe("document"); expect(document.activeElement).toBe(input)
  expect(mocks.list).toHaveBeenLastCalledWith({ kind: "document", limit: 50 })
})
it("can reset an empty filtered result without losing the search focus", async () => {
  mocks.list.mockResolvedValueOnce({ items: [], nextCursor: null })
  await search("未找到的链接")
  await click("清除搜索与筛选")
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(document.activeElement).toBe(document.querySelector('input[aria-label="搜索浏览历史"]'))
  expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50 })
  expect(document.querySelector('button[aria-label="打开 项目文档"]')).toBeTruthy()
})
it("keeps the query when retrying from the initial error state", async () => {
  mocks.list.mockRejectedValueOnce(new Error("暂时不可用"))
  const input = await search("项目")
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("暂时不可用")
  await click("重试")
  expect(mocks.list).toHaveBeenLastCalledWith({ query: "项目", limit: 50 })
  expect(input.value).toBe("项目")
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.querySelector('button[aria-label="打开 项目文档"]')).toBeTruthy()
})
