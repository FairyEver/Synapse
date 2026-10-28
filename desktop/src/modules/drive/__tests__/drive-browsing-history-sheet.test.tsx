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
beforeEach(async () => {
  vi.resetAllMocks(); vi.useFakeTimers(); mocks.list.mockResolvedValue({ items: [{ id: "one", title: "项目文档", author: "author", kind: "document", url: "https://example.com/share", visitedAt: new Date().toISOString() }], nextCursor: null }); mocks.clear.mockResolvedValue({ ok: true })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<DriveBrowsingHistorySheet open accountId="account" onOpenChange={vi.fn()} />) }); await act(async () => { await vi.advanceTimersByTimeAsync(260) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
it("opens the entire history row in the default browser and confirms before clearing", async () => {
  expect(document.body.textContent).toContain("今天"); expect(document.body.textContent).toContain("author")
  expect(document.body.textContent).not.toContain("https://example.com/share")
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
