/** @vitest-environment jsdom */
import { mocks, mount, flush, deferred } from "./harness"
import { act } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { MailLayout } from "../layout"
import { useMail } from "../use-mail"
import type { Draft } from "../../../../app-capabilities/mail/shared/types"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const draft: Omit<Draft, "html" | "text"> = { id: "md_one", accountId: "ma_one", revision: 7, to: [], cc: [], bcc: [], subject: "第一封草稿", assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "synced", updatedAt: "2026-10-23T00:00:00Z" }
const second = { ...draft, id: "md_two", revision: 9, subject: "第二封草稿" }
const third = { ...draft, id: "md_three", revision: 11, subject: "第三封草稿" }
const compose = vi.fn()
let current: ReturnType<typeof useMail>
let remaining: typeof draft[]
function Harness() { current = useMail(); return <MailLayout mail={current} onSettings={vi.fn()} onCompose={compose} /> }
beforeEach(() => {
  vi.clearAllMocks()
  remaining = [draft, second, third]
  mocks.api.draftList.mockImplementation(async ({ cursor, limit }: { cursor?: string; limit: number }) => {
    const offset = Number(cursor ?? 0)
    return { items: remaining.slice(offset, offset + limit), nextCursor: offset + limit < remaining.length ? String(offset + limit) : null }
  })
  mocks.api.draftDelete = vi.fn().mockImplementation(async ({ draftId }) => { remaining = remaining.filter(item => item.id !== draftId); return { success: true } })
})
async function setup() {
  mount(<Harness />); await flush()
  act(() => current.selectView({ drafts: true })); await flush()
}
function button(label: string) {
  const node = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(node, label).not.toBeNull()
  return node!
}
function select(label: string) { act(() => button(label).click()) }
async function requestDelete() {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  expect(trigger).not.toBeNull()
  act(() => trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
  await flush()
  const actions = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(actions.map(item => item.textContent)).toEqual(["删除草稿"])
  act(() => actions[0].click()); await flush()
}
function confirmButton(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(item => item.textContent === label)
  expect(node).toBeDefined()
  return node!
}

it("selects drafts individually or by page without opening the editor, and confirms deletion", async () => {
  await setup()
  expect(document.querySelector('button[aria-label="搜索邮件"]')).toBeNull()
  select("选择 第一封草稿")
  expect(button("选择当前页草稿").getAttribute("aria-checked")).toBe("mixed")
  expect(document.querySelector('[aria-label="已选 1 封草稿"]')).not.toBeNull()
  expect(compose).not.toHaveBeenCalled()
  select("选择当前页草稿")
  expect(document.querySelector('[aria-label="已选 3 封草稿"]')).not.toBeNull()
  select("选择当前页草稿")
  expect(button("选择 第一封草稿").getAttribute("aria-checked")).toBe("false")
  select("选择 第一封草稿"); select("选择 第二封草稿")
  await requestDelete()
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("删除 2 封草稿？")
  expect(mocks.api.draftDelete).not.toHaveBeenCalled()
  act(() => confirmButton("取消").click()); await flush()
  expect(mocks.api.draftDelete).not.toHaveBeenCalled()
  await requestDelete()
  await act(async () => { confirmButton("删除草稿").click() }); await flush()
  expect(mocks.api.draftDelete.mock.calls).toEqual([[{ draftId: draft.id, expectedRevision: 7 }], [{ draftId: second.id, expectedRevision: 9 }]])
  expect(mocks.api.messageDelete).not.toHaveBeenCalled()
  expect(current.drafts.map(item => item.id)).toEqual([third.id])
  expect(document.querySelector('[aria-label^="已选 "]')).toBeNull()
})

it("retains failed drafts and their selection while deleting the remaining drafts", async () => {
  mocks.api.draftDelete.mockImplementation(async ({ draftId }) => {
    if (draftId === second.id) throw new Error("草稿已被修改，请重新读取")
    remaining = remaining.filter(item => item.id !== draftId); return { success: true }
  })
  await setup(); select("选择当前页草稿"); await requestDelete()
  await act(async () => { confirmButton("删除草稿").click() }); await flush()
  expect(mocks.api.draftDelete).toHaveBeenCalledTimes(3)
  expect(current.drafts.map(item => item.id)).toEqual([second.id])
  expect(button("选择 第二封草稿").getAttribute("aria-checked")).toBe("true")
  expect(document.querySelector('[aria-label="已选 1 封草稿"]')).not.toBeNull()
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("草稿已被修改，请重新读取"))
})

it("disables draft selection and repeat deletion while the request is pending", async () => {
  const pending = deferred<{ success: boolean }>()
  mocks.api.draftDelete.mockReturnValueOnce(pending.promise)
  await setup(); select("选择 第一封草稿"); await requestDelete()
  act(() => confirmButton("删除草稿").click()); await flush()
  expect(button("选择当前页草稿").disabled).toBe(true)
  expect(button("选择 第二封草稿").disabled).toBe(true)
  expect(confirmButton("删除草稿").disabled).toBe(true)
  await act(async () => { remaining = remaining.filter(item => item.id !== draft.id); pending.resolve({ success: true }) }); await flush()
  expect(mocks.api.draftDelete).toHaveBeenCalledTimes(1)
})

it("caps page selection at 100 drafts and preserves it when another page is appended", async () => {
  remaining = Array.from({ length: 101 }, (_, index) => ({ ...draft, id: `md_${index}`, subject: `草稿 ${index}` }))
  await setup()
  await act(async () => { await current.loadMore() })
  await act(async () => { await current.loadMore() })
  select("选择当前页草稿")
  expect(document.querySelector('[aria-label="已选 100 封草稿"]')).not.toBeNull()
  expect(button("选择 草稿 100").disabled).toBe(true)
  remaining = [...remaining, { ...draft, id: "md_next", subject: "下一页草稿" }]
  await act(async () => { await current.refresh() })
  expect(document.querySelector('[aria-label="已选 100 封草稿"]')).not.toBeNull()
  select("选择 草稿 0"); select("选择 下一页草稿")
  expect(button("选择 下一页草稿").getAttribute("aria-checked")).toBe("true")
})

it("keeps failed later-page drafts selected across deletion and subsequent refreshes", async () => {
  remaining = Array.from({ length: 100 }, (_, index) => ({ ...draft, id: `md_${index}`, subject: `草稿 ${index}` }))
  mocks.api.draftDelete.mockRejectedValue(new Error("远端草稿删除失败"))
  await setup()
  await act(async () => { await current.loadMore() })
  select("选择 草稿 60"); await requestDelete()
  await act(async () => { confirmButton("删除草稿").click() }); await flush()
  expect(button("选择 草稿 60").getAttribute("aria-checked")).toBe("true")
  await act(async () => { await current.refresh() })
  expect(button("选择 草稿 60").getAttribute("aria-checked")).toBe("true")
  expect(current.drafts).toHaveLength(100)
  expect(current.cursor).toBeNull()
})

it("rejects empty, duplicate, oversized, or out-of-account draft selections before writing", async () => {
  remaining = [...remaining, { ...draft, id: "md_other", accountId: "ma_two" }]
  await setup()
  for (const ids of [[], [draft.id, draft.id], Array.from({ length: 101 }, (_, index) => `md_${index}`), [draft.id, "md_missing"], [draft.id, "md_other"]]) {
    await expect(current.deleteDrafts(ids)).rejects.toThrow()
  }
  expect(mocks.api.draftDelete).not.toHaveBeenCalled()
})

it("stops the remaining draft deletions when the mailbox account changes", async () => {
  const pending = deferred<{ success: boolean }>()
  mocks.api.draftDelete.mockReturnValueOnce(pending.promise)
  await setup()
  let deleting!: ReturnType<typeof current.deleteDrafts>
  act(() => { deleting = current.deleteDrafts([draft.id, second.id]) })
  act(() => current.selectAccount("ma_two")); await flush()
  await act(async () => { pending.resolve({ success: true }); await expect(deleting).rejects.toThrow("邮箱账号已变化") })
  expect(mocks.api.draftDelete).toHaveBeenCalledTimes(1)
  expect(current.accountId).toBe("ma_two")
  expect(current.drafts).toEqual([])
})
