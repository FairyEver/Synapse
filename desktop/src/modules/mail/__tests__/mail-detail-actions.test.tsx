/** @vitest-environment jsdom */
import { mocks, mount, flush, detail, deferred } from "./harness"
import { act } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { MailLayout } from "../layout"
import { useMail } from "../use-mail"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const writeText = vi.fn(), compose = vi.fn()
let current: ReturnType<typeof useMail>
function Harness() { current = useMail(); return <MailLayout mail={current} onSettings={vi.fn()} onCompose={compose} /> }
beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})
async function setup() {
  mount(<Harness />); await flush()
  await act(async () => { await current.selectMessage(detail.id) }); await flush()
}
function toolbarButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('article button')].find(button => button.textContent === label)
  expect(button).toBeDefined()
  return button!
}
async function openMore() {
  act(() => toolbarButton("更多").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
  await flush()
}
function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === label)
  expect(item).toBeDefined()
  return item!
}

it("copies the message ID from the toolbar and plain body from more", async () => {
  mocks.api.bodyReadChunk.mockResolvedValue({ bodyRef: "mas_body", html: "<p>第一行</p><p>第二行</p>", text: "第一行\n第二行", complete: true, nextCursor: null, truncated: false })
  await setup()
  expect(document.querySelector('article')?.textContent).not.toContain("回复全部")
  act(() => toolbarButton("复制ID").click()); await flush()
  expect(writeText).toHaveBeenLastCalledWith("em_one")
  expect(toast).toHaveBeenLastCalledWith("ID 已复制")
  await openMore()
  act(() => menuItem("复制正文").click()); await flush()
  expect(writeText).toHaveBeenLastCalledWith("第一行\n第二行")
  expect(toast).toHaveBeenLastCalledWith("正文已复制")
})

it("opens reply and forward from the toolbar and reply all from more", async () => {
  await setup()
  act(() => toolbarButton("回复").click()); await flush()
  expect(compose).toHaveBeenLastCalledWith({ accountId: "ma_one", sourceMessageId: "em_one", mode: "reply" })
  act(() => toolbarButton("转发").click()); await flush()
  expect(compose).toHaveBeenLastCalledWith({ accountId: "ma_one", sourceMessageId: "em_one", mode: "forward" })
  await openMore()
  act(() => menuItem("回复全部").click()); await flush()
  expect(compose).toHaveBeenLastCalledWith({ accountId: "ma_one", sourceMessageId: "em_one", mode: "reply_all" })
})

it("does not copy an incomplete body while it is loading or truncated", async () => {
  const pending = deferred<unknown>()
  mocks.api.bodyReadChunk.mockReturnValue(pending.promise)
  await setup(); await openMore()
  expect(menuItem("复制正文").getAttribute("aria-disabled")).toBe("true")
  act(() => menuItem("复制正文").click()); await flush()
  expect(writeText).not.toHaveBeenCalled()
  await act(async () => { pending.resolve({ bodyRef: "mas_body", html: "", text: "部分正文", complete: false, nextCursor: null, truncated: true }) }); await flush()
  expect(menuItem("复制正文").getAttribute("aria-disabled")).toBe("true")
})

it("reports a clipboard failure without claiming success", async () => {
  writeText.mockRejectedValue(new Error("Clipboard unavailable"))
  await setup(); await openMore()
  act(() => menuItem("复制正文").click()); await flush()
  expect(toast.error).toHaveBeenCalledWith("复制失败")
  expect(toast).not.toHaveBeenCalled()
})
