/** @vitest-environment jsdom */
import { mocks, mount, flush, detail, summary, deferred } from "./harness"
import { act } from "react"
import { expect, it } from "vitest"
import { MailDetail } from "../message-detail"
import { useMail } from "../use-mail"
let current: ReturnType<typeof useMail>
function Harness() { current = useMail(); return null }
it("opens the inbox after folders load without first fetching all mail", async () => {
  const folders = deferred<unknown>()
  mocks.api.folderList.mockReturnValue(folders.promise)
  mount(<Harness />); await flush()
  expect(mocks.api.messageList).not.toHaveBeenCalled()
  folders.resolve({ items: [{ id: "mf_one", accountId: "ma_one", role: "inbox", selectable: true }], nextCursor: null })
  await flush()
  expect(current.view).toEqual({ folderId: "mf_one" })
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "ma_one", folderId: "mf_one" }))
})
it("loads the new account's inbox when switching accounts", async () => {
  mocks.api.folderList.mockImplementation(async ({ accountId }) => ({ items: [{ id: `inbox_${accountId}`, accountId, role: "inbox", selectable: true }], nextCursor: null }))
  mount(<Harness />); await flush()
  act(() => current.selectView({ drafts: true })); await flush()
  act(() => current.selectAccount("ma_two")); await flush()
  expect(current.view).toEqual({ folderId: "inbox_ma_two" })
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "ma_two", folderId: "inbox_ma_two" }))
})
it("preserves an explicit all-mail selection when folders refresh", async () => {
  mount(<Harness />); await flush()
  act(() => current.selectView({})); await flush()
  await act(async () => { await current.loadAccounts() })
  expect(current.view).toEqual({})
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: undefined }))
})
it("selects the inbox when initial synchronization discovers it later", async () => {
  mocks.api.folderList.mockResolvedValueOnce({ items: [], nextCursor: null })
  mount(<Harness />); await flush()
  expect(mocks.api.messageList).not.toHaveBeenCalled()
  await act(async () => { await current.loadAccounts() })
  expect(current.view).toEqual({ folderId: "mf_one" })
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: "mf_one" }))
})
it("keeps a manual selection and a directly opened message when folders arrive", async () => {
  const folders = deferred<unknown>()
  mocks.api.folderList.mockReturnValue(folders.promise)
  mount(<Harness />); await flush()
  act(() => current.selectView({ starredOnly: true })); await flush()
  await act(async () => { await current.selectMessage(summary.id) })
  folders.resolve({ items: [{ id: "mf_one", accountId: "ma_one", role: "inbox", selectable: true }], nextCursor: null })
  await flush()
  expect(current.view).toEqual({ starredOnly: true })
  expect(current.folders).toHaveLength(1)
  expect(current.detail?.id).toBe(summary.id)
})
it("refreshes the selected server folder instead of waiting for the background folder sweep", async () => {
  mount(<Harness />); await flush()
  act(() => current.selectView({ folderId: "mf_sent" })); await flush()
  await act(async () => { await current.sync() })
  expect(mocks.api.syncStart).toHaveBeenLastCalledWith({ accountId: "ma_one", folderId: "mf_sent" })
  act(() => current.selectView({})); await flush()
  await act(async () => { await current.sync() })
  expect(mocks.api.syncStart).toHaveBeenLastCalledWith({ accountId: "ma_one" })
})
it("preserves individual restore results and ignores old identity events", async () => {
  mount(<Harness />); await flush()
  mocks.api.messageRestore.mockResolvedValue({ items: [{ id: summary.id, status: "unknown", code: "UNCONFIRMED" }] })
  let result: unknown
  await act(async () => { result = await current.mutate("restore", [summary.id]) })
  expect(result).toMatchObject({ items: [{ status: "unknown" }] })
  const calls = mocks.api.messageList.mock.calls.length
  act(() => mocks.changed({ ownerId: "other", generation: 1, accountId: "ma_one", ids: [], revision: 1 })); await flush()
  expect(mocks.api.messageList).toHaveBeenCalledTimes(calls)
})
it("uses a fixed sandbox for cleaned complete HTML and provides a back action", () => {
  const back = () => undefined
  mount(<MailDetail detail={detail} body={{ html: "<p>hello<script>alert(1)</script><img src='https://private/x'></p>", text: "hello", complete: true, truncated: false }} resources={{ cid: {}, remote: {} }} onBack={back} onResource={() => undefined} onDownload={() => undefined} onLink={() => undefined} onReply={() => undefined} onCopy={() => undefined} />)
  const iframe = document.querySelector("iframe")!
  expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin")
  expect(iframe.getAttribute("srcdoc")).not.toContain("<script")
  expect(iframe.getAttribute("srcdoc")).toContain("default-src 'none'")
  expect(document.querySelector('button[aria-label="返回邮件列表"]')).toBeTruthy()
})
