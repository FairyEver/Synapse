/** @vitest-environment jsdom */
import { act } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { deferred, flush, mocks, mount } from "./harness"
import { MailNavigation } from "../navigation"
import { useMail } from "../use-mail"
import type { Folder } from "../../../../app-capabilities/mail/shared/types"

const custom: Folder = { id: "mf_custom", accountId: "ma_one", name: "客户资料", path: "客户资料", role: "none", selectable: true, serverCount: 0, uidValidity: "1", metadataComplete: true }
const inbox: Folder = { ...custom, id: "mf_one", name: "INBOX", path: "INBOX", role: "inbox" }
let folders: Folder[], mail: ReturnType<typeof useMail>
function Harness() {
  mail = useMail()
  return <MailNavigation {...mail} onView={mail.selectView} onSettings={() => undefined} onFolderChange={mail.changeFolder} />
}
function button(label: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)
  expect(element, `button ${label}`).toBeTruthy()
  return element!
}
async function context(label: string) {
  act(() => button(label).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })))
  await flush()
}
async function choose(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === label)
  expect(item, `menu item ${label}`).toBeTruthy()
  act(() => item!.click()); await flush()
}
function input(value: string) {
  const element = document.querySelector<HTMLInputElement>("#mail-folder-name")!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
beforeEach(() => {
  folders = [inbox, custom]
  mocks.api.folderList.mockImplementation(async () => ({ items: folders, nextCursor: null }))
  mocks.api.folderRename = vi.fn(async ({ name }: { name: string }) => {
    folders = folders.map(folder => folder.id === custom.id ? { ...folder, name, path: name } : folder)
    return folders.find(folder => folder.id === custom.id)
  })
  mocks.api.folderDelete = vi.fn(async () => { folders = folders.filter(folder => folder.id !== custom.id); return { success: true } })
})

it("renames an ordinary folder from its context menu without selecting it or exposing creation", async () => {
  mount(<Harness />); await flush()
  await context(custom.name)
  expect(mail.view).toEqual({})
  expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(["重命名", "删除文件夹"])
  expect(document.body.textContent).not.toContain("新建文件夹")
  await choose("重命名")
  expect(document.querySelector<HTMLInputElement>("#mail-folder-name")?.value).toBe(custom.name)
  expect(document.activeElement?.id).toBe("mail-folder-name")
  input("  项目资料  ")
  await act(async () => button("保存").click()); await flush()
  expect(mocks.api.folderRename).toHaveBeenCalledWith({ accountId: "ma_one", folderId: custom.id, name: "项目资料" })
  expect(mail.folders.find(folder => folder.id === custom.id)?.name).toBe("项目资料")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.activeElement).toBe(button("项目资料"))
})

it("does not offer folder mutations for system folders or virtual views", async () => {
  folders.push({ ...inbox, id: "mf_unmapped_inbox", role: "none" })
  mount(<Harness />); await flush()
  for (const label of ["收件箱", "INBOX", "草稿箱", "全部邮件", "星标邮件"]) {
    await context(label)
    expect(document.querySelector('[role="menuitem"]')).toBeNull()
  }
})

it("keeps another selected folder when deleting an ordinary folder", async () => {
  mount(<Harness />); await flush()
  act(() => mail.selectView({ folderId: inbox.id })); await flush()
  await context(custom.name); await choose("删除文件夹")
  await act(async () => button("删除文件夹").click()); await flush()
  expect(mail.view).toEqual({ folderId: inbox.id })
  expect(mail.folders.some(folder => folder.id === custom.id)).toBe(false)
})

it("validates names and protects system folders before a mutation reaches the bridge", async () => {
  mount(<Harness />); await flush()
  await expect(mail.changeFolder("rename", custom.id, "一行\n另一行")).rejects.toThrow("文件夹名称须为 1–255 个字符，且不能包含换行")
  await expect(mail.changeFolder("rename", custom.id, "a".repeat(256))).rejects.toThrow("文件夹名称须为 1–255 个字符，且不能包含换行")
  await expect(mail.changeFolder("delete", inbox.id)).rejects.toThrow("系统文件夹不能改名或删除")
  expect(mocks.api.folderRename).not.toHaveBeenCalled()
  expect(mocks.api.folderDelete).not.toHaveBeenCalled()
})

it("requires confirmation, prevents repeated delete submissions and leaves a deleted selected folder", async () => {
  const pending = deferred<{ success: boolean }>()
  mocks.api.folderDelete.mockImplementation(() => pending.promise)
  mount(<Harness />); await flush()
  act(() => mail.selectView({ folderId: custom.id })); await flush()
  await context(custom.name); await choose("删除文件夹")
  expect(mocks.api.folderDelete).not.toHaveBeenCalled()
  act(() => button("取消").click()); await flush()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.activeElement).toBe(button(custom.name))
  expect(mocks.api.folderDelete).not.toHaveBeenCalled()
  await context(custom.name); await choose("删除文件夹")
  act(() => button("删除文件夹").click()); await flush()
  expect(button("删除中").disabled).toBe(true)
  act(() => button("删除中").click())
  expect(mocks.api.folderDelete).toHaveBeenCalledTimes(1)
  expect(mocks.api.folderDelete).toHaveBeenCalledWith({ accountId: "ma_one", folderId: custom.id })
  folders = [inbox]
  await act(async () => pending.resolve({ success: true })); await flush()
  expect(mail.view).toEqual({})
  expect(mail.folders.map(folder => folder.id)).toEqual([inbox.id])
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.activeElement).toBe(button("全部邮件"))
  expect(mocks.api.messageList).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "ma_one", folderId: undefined }))
})

it("keeps a folder and its confirmation visible when the server refuses deletion", async () => {
  mocks.api.folderDelete.mockRejectedValue(new Error("文件夹仍有子文件夹"))
  mount(<Harness />); await flush()
  await context(custom.name); await choose("删除文件夹")
  await act(async () => button("删除文件夹").click()); await flush()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("文件夹仍有子文件夹")
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  expect(mail.folders.some(folder => folder.id === custom.id)).toBe(true)
})

it("blocks an empty rename and preserves the name after a failure until corrected", async () => {
  mocks.api.folderRename.mockRejectedValue(new Error("文件夹已存在"))
  mount(<Harness />); await flush()
  await context(custom.name); await choose("重命名")
  input("   "); expect(button("保存").disabled).toBe(true)
  expect(mocks.api.folderRename).not.toHaveBeenCalled()
  input("重复名称")
  await act(async () => button("保存").click()); await flush()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("文件夹已存在")
  expect(document.querySelector<HTMLInputElement>("#mail-folder-name")?.value).toBe("重复名称")
  input("其他名称")
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it("closes the old folder dialog and ignores a late response after switching mailbox accounts", async () => {
  const pending = deferred<Folder>()
  mocks.api.folderRename.mockImplementation(() => pending.promise)
  mount(<Harness />); await flush()
  await context(custom.name); await choose("重命名"); input("其他名称")
  act(() => button("保存").click()); await flush()
  expect(mocks.api.folderRename).toHaveBeenCalledTimes(1)
  act(() => mail.selectAccount("ma_two")); await flush()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const calls = mocks.api.folderList.mock.calls.length
  await act(async () => pending.resolve({ ...custom, name: "其他名称" })); await flush()
  expect(mail.accountId).toBe("ma_two")
  expect(mail.view).toEqual({})
  expect(mocks.api.folderList).toHaveBeenCalledTimes(calls)
})

it("closes the old folder dialog after the Synapse identity changes", async () => {
  mount(<Harness />); await flush()
  await context(custom.name); await choose("重命名")
  mocks.owner = "other"
  mount(<Harness />); await flush()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.api.folderRename).not.toHaveBeenCalled()
})
