/** @vitest-environment jsdom */
import { act } from "react"
import { expect, it, vi } from "vitest"
import { flush, mocks, mount, summary } from "./harness"
import { MailList } from "../message-list"
import { MailLayout } from "../layout"
import { useMail } from "../use-mail"
import type { Draft, Folder } from "../../../../app-capabilities/mail/shared/types"

const inbox: Folder = { id: "mf_one", accountId: "ma_one", name: "INBOX", path: "INBOX", role: "inbox", selectable: true, serverCount: 1, uidValidity: "1", metadataComplete: true }
const trash: Folder = { ...inbox, id: "mf_trash", name: "Trash", role: "trash" }
const draftFolder: Folder = { ...inbox, id: "mf_drafts", name: "Drafts", role: "drafts" }
const custom: Folder = { ...inbox, id: "mf_custom", name: "项目邮件", role: "none" }
const folders = [inbox, trash, draftFolder, custom, { ...custom, id: "mf_parent", name: "不可选择", selectable: false }]
const other = { ...summary, id: "em_two", subject: "另一封邮件" }
const draft: Omit<Draft, "html" | "text"> = { id: "md_one", accountId: "ma_one", revision: 7, to: [], cc: [], bcc: [], subject: "测试草稿", assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "synced", updatedAt: "2026-10-24T00:00:00Z" }

async function context(subject: string) {
  const row = [...document.querySelectorAll('button[data-track="mail.message.open"], button[data-track="mail.draft.open"]')].find(node => node.textContent?.includes(subject))!
  act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })))
  await flush()
}
function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === label)
  expect(item, label).toBeTruthy()
  return item!
}
async function choose(label: string) { act(() => menuItem(label).click()); await flush() }
async function confirm(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(node => node.textContent === label)!
  act(() => button.click()); await flush()
}

it.each([
  ["标记已读", "read"], ["标记未读", "unread"], ["加星标", "star"],
  ["取消星标", "unstar"], ["移至回收站", "delete"], ["恢复到收件箱", "restore"],
])("%s affects only the right-clicked message and preserves the checked and open messages", async (label, action) => {
  const onBatch = vi.fn(), onSelect = vi.fn()
  mount(<MailList items={[summary, other]} drafts={[]} selected={summary.id} loading={false} more={false} folders={folders} onSelect={onSelect} onDraft={vi.fn()} onMore={vi.fn()} onMove={vi.fn()} onBatch={onBatch} />)
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="选择当前页邮件"]')!.click())
  await context(other.subject)
  expect(onSelect).not.toHaveBeenCalled()
  expect(onBatch).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="已选 2 封邮件"]')).not.toBeNull()
  expect([...document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent === "永久删除")).toBe(false)
  await choose(label)
  expect(onBatch).toHaveBeenCalledExactlyOnceWith(action, [other.id])
  expect(onSelect).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="已选 2 封邮件"]')).not.toBeNull()
})

it("moves only the target message and excludes drafts and non-selectable folders", async () => {
  const onMove = vi.fn()
  mount(<MailList items={[summary, other]} drafts={[]} loading={false} more={false} folders={folders} onSelect={vi.fn()} onDraft={vi.fn()} onMore={vi.fn()} onMove={onMove} onBatch={vi.fn()} />)
  await context(other.subject)
  act(() => menuItem("移动至").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })))
  await flush()
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)
  expect(labels).toContain(custom.name)
  expect(labels).not.toContain("草稿箱")
  expect(labels).not.toContain("不可选择")
  await choose(custom.name)
  expect(onMove).toHaveBeenCalledExactlyOnceWith([other.id], custom.id)
})

it("disables an already-open menu when an operation starts", async () => {
  const onBatch = vi.fn()
  const render = (busy: boolean) => mount(<MailList busy={busy} items={[summary]} drafts={[]} loading={false} more={false} folders={folders} onSelect={vi.fn()} onDraft={vi.fn()} onMore={vi.fn()} onMove={vi.fn()} onBatch={onBatch} />)
  render(false); await context(summary.subject); render(true)
  expect(menuItem("标记已读").getAttribute("aria-disabled")).toBe("true")
  await choose("标记已读")
  expect(onBatch).not.toHaveBeenCalled()
})

it.each([false, true])("uses the existing confirmation before deleting a single target (draft: %s)", async draftView => {
  let mail!: ReturnType<typeof useMail>
  const onCompose = vi.fn()
  function Harness() { mail = useMail(); return <MailLayout mail={mail} onSettings={vi.fn()} onCompose={onCompose} /> }
  mocks.api.folderList.mockResolvedValue({ items: folders, nextCursor: null })
  mocks.api.messageList.mockResolvedValue({ items: [{ ...summary, locator: { ...summary.locator, folderId: trash.id } }, other], nextCursor: null })
  mocks.api.draftList.mockResolvedValue({ items: [draft, { ...draft, id: "md_two", subject: "其他草稿" }], nextCursor: null })
  mocks.api.draftDelete = vi.fn().mockResolvedValue({ success: true })
  mocks.api.messageDelete.mockResolvedValue({ items: [{ id: summary.id, status: "succeeded" }] })
  mount(<Harness />); await flush()
  if (draftView) { act(() => mail.selectView({ drafts: true })); await flush() }
  const subject = draftView ? draft.subject : summary.subject
  const action = draftView ? "删除草稿" : "永久删除"
  act(() => document.querySelector<HTMLButtonElement>(`[aria-label="选择当前页${draftView ? "草稿" : "邮件"}"]`)!.click())
  await context(subject)
  if (draftView) expect([...document.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)).toEqual([action])
  await choose(action)
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(draftView ? "删除 1 封草稿？" : "永久删除 1 封邮件？")
  expect(mocks.api.draftDelete).not.toHaveBeenCalled()
  expect(mocks.api.messageDelete).not.toHaveBeenCalled()
  await confirm("取消")
  await context(subject); await choose(action); await confirm(action)
  if (draftView) {
    expect(mocks.api.draftDelete).toHaveBeenCalledExactlyOnceWith({ draftId: draft.id, expectedRevision: 7 })
    expect(mocks.api.messageDelete).not.toHaveBeenCalled()
  } else {
    expect(mocks.api.messageDelete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageIds: [summary.id], permanent: true }))
    expect(mocks.api.draftDelete).not.toHaveBeenCalled()
  }
  expect(onCompose).not.toHaveBeenCalled()
  expect(mocks.api.messageGet).not.toHaveBeenCalled()
})
