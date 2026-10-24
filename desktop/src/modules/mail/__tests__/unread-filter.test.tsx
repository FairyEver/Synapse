/** @vitest-environment jsdom */
import { mocks, mount, flush, summary, coverage } from "./harness"
import { act } from "react"
import { expect, it } from "vitest"
import { useMail } from "../use-mail"
import { MailLayout } from "../layout"

let current: ReturnType<typeof useMail>
function Harness() {
  current = useMail()
  return <MailLayout mail={current} onSettings={() => undefined} onCompose={() => undefined} />
}

it("filters the current folder from the toolbar, keeps the filter for paging and search, and can return to all", async () => {
  mocks.api.messageList.mockResolvedValue({ items: [summary], nextCursor: "next-page", coverage })
  mocks.api.searchStart.mockResolvedValue({ jobId: "mj_search" })
  mocks.api.searchGet.mockResolvedValue({ items: [], nextCursor: null, coverage, canContinue: false })
  mount(<Harness />); await flush()
  const toggle = () => document.querySelector<HTMLButtonElement>('button[aria-label="仅看未读"]')
  expect(toggle()).not.toBeNull()
  expect(toggle()!.getAttribute("aria-pressed")).toBe("false")
  act(() => toggle()!.click()); await flush()
  expect(toggle()!.getAttribute("aria-pressed")).toBe("true")
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: "mf_one", unreadOnly: true }))
  await act(async () => { await current.loadMore() })
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: "mf_one", unreadOnly: true, cursor: "next-page" }))
  await act(async () => { await current.search("报告", "body") })
  expect(mocks.api.searchStart).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: "mf_one", unreadOnly: true, query: "报告", fields: "body" }))
  await act(async () => { await current.search("") })
  act(() => toggle()!.click()); await flush()
  expect(toggle()!.getAttribute("aria-pressed")).toBe("false")
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: "mf_one", unreadOnly: false }))
})

it("combines unread and starred searches, resets on account changes, and hides the filter in drafts", async () => {
  mount(<Harness />); await flush()
  act(() => current.selectView({ starredOnly: true, unreadOnly: true })); await flush()
  mocks.api.searchStart.mockResolvedValue({ jobId: "mj_search" })
  mocks.api.searchGet.mockResolvedValue({ items: [], nextCursor: null, coverage, canContinue: false })
  await act(async () => { await current.search("报告") })
  expect(mocks.api.searchStart).toHaveBeenLastCalledWith(expect.objectContaining({ starredOnly: true, unreadOnly: true }))
  act(() => current.selectAccount("ma_two")); await flush()
  expect(current.view.unreadOnly).not.toBe(true)
  act(() => current.selectView({ drafts: true })); await flush()
  expect(document.querySelector('button[aria-label="仅看未读"]')).toBeNull()
})
