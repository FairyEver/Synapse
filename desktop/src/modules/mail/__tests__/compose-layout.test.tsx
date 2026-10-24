/** @vitest-environment jsdom */
import { mocks, mount, flush } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { MailCompose } from "../compose"
import { useCompose } from "../use-compose"
import type { Draft } from "../../../../app-capabilities/mail/shared/types"

const draft: Draft = { id: "md_draft", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "", html: "", text: "", assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
let model: ReturnType<typeof useCompose>
function Harness() {
  model = useCompose("user")
  return <MailCompose model={model} accounts={[]} />
}
async function setup(value = draft) {
  mocks.api.draftGet = vi.fn().mockResolvedValue(value)
  mocks.api.composeRetainAssets = vi.fn().mockResolvedValue(undefined)
  mocks.api.draftUpdate = vi.fn().mockImplementation(async ({ patch }) => ({ ...value, ...patch, revision: 2 }))
  mount(<Harness />)
  await flush()
  await act(async () => { await model.open({ draftId: value.id }) })
  await flush()
}
const input = (field: string) => document.querySelector<HTMLInputElement>(`#mail-compose-${field}`)
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

it("reveals optional recipients on demand, focuses the field and saves their addresses", async () => {
  await setup()
  expect(input("to")).not.toBeNull()
  expect(input("cc")).toBeNull()
  expect(input("bcc")).toBeNull()
  expect(button("添加密送")).toBeNull()
  act(() => button("添加抄送").click())
  expect(document.activeElement).toBe(input("cc"))
  act(() => model.changeAddress("cc", "copy@example.com"))
  await act(async () => { await model.save() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ cc: [{ address: "copy@example.com" }], bcc: [] }) }))
  act(() => model.changeAddress("cc", ""))
  expect(input("cc")).not.toBeNull()
})

it("shows prefilled recipients and resets empty field disclosure for the next editing session", async () => {
  await setup({ ...draft, cc: [{ address: "copy@example.com" }], bcc: [{ address: "hidden@example.com" }] })
  expect(input("cc")?.value).toBe("copy@example.com")
  expect(input("bcc")).toBeNull()
  expect(button("添加密送")).toBeNull()
  expect(button("添加抄送")).toBeNull()
  act(() => input("cc")!.focus())
  act(() => model.changeAddress("cc", ""))
  expect(input("cc")).not.toBeNull()
  await act(async () => { await model.close() })
  await act(async () => { await model.resolveClose("discard") })
  mocks.api.draftGet.mockResolvedValue(draft)
  await act(async () => { await model.open({ draftId: draft.id }) })
  expect(input("cc")).toBeNull()
  expect(input("bcc")).toBeNull()
})

it("retains one attachment entry and exposes history actions without toggle semantics", async () => {
  await setup()
  expect(button("关闭写信")).toBeNull()
  const attachmentButtons = [...document.querySelectorAll("button")].filter(node => node.textContent === "附件" || node.getAttribute("aria-label") === "添加附件")
  expect(attachmentButtons).toHaveLength(1)
  expect(button("撤销").hasAttribute("aria-pressed")).toBe(false)
  expect(button("重做").hasAttribute("aria-pressed")).toBe(false)
  expect(button("粗体").getAttribute("aria-pressed")).toBe("false")
  act(() => button("插入链接").click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("插入链接")
})
it("associates an address error with its field and keeps it until that field is corrected", async () => {
  await setup()
  act(() => model.changeAddress("cc", "invalid-address"))
  await act(async () => { await expect(model.save()).rejects.toThrow("抄送地址格式无效") })
  const cc = input("cc")!
  expect(cc.getAttribute("aria-invalid")).toBe("true")
  const message = document.getElementById(cc.getAttribute("aria-describedby")!)
  expect(message?.getAttribute("role")).toBe("alert")
  expect(message?.textContent).toContain("抄送地址格式无效")
  expect(input("to")?.getAttribute("aria-invalid")).not.toBe("true")
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
  act(() => model.changeAddress("to", "recipient@example.com"))
  expect(cc.getAttribute("aria-invalid")).toBe("true")
  act(() => model.changeAddress("cc", "copy@example.com"))
  expect(cc.getAttribute("aria-invalid")).not.toBe("true")
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
  await act(async () => { await model.save() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ to: [{ address: "recipient@example.com" }], cc: [{ address: "copy@example.com" }] }) }))
})
it("can verify a pending Sent copy after SMTP acceptance without sending the message again", async () => {
  await setup({ ...draft, to: [{ address: "to@example.com" }] })
  mocks.api.sendPreview = vi.fn().mockResolvedValue({ previewId: "mp_one", expiresAt: "2099-01-01T00:00:00Z" })
  mocks.api.messageSend = vi.fn().mockResolvedValue({ operationId: "mo_one", state: "accepted", accepted: ["to@example.com"], rejected: [], sentCopyState: "pending", errorCode: null })
  mocks.api.operationGet = vi.fn().mockResolvedValue({ operationId: "mo_one", state: "accepted", accepted: ["to@example.com"], rejected: [], sentCopyState: "saved", errorCode: null })
  await act(async () => { await model.send() })
  const verify = [...document.querySelectorAll("button")].find(node => node.textContent === "核验已发送副本")
  expect(verify).toBeTruthy()
  await act(async () => { verify!.click() }); await flush()
  expect(document.body.textContent).toContain("已发送副本：已保存")
  expect(mocks.api.messageSend).toHaveBeenCalledTimes(1)
})
it("identifies a reopened consumed draft as sent and keeps its controls read-only", async () => {
  await setup({ ...draft, state: "consumed", subject: "已提交的邮件" })
  expect(document.querySelector('[role="status"]')?.textContent).toBe("已发送")
  expect([...document.querySelectorAll("button")].find(node => node.textContent === "发送")?.disabled).toBe(true)
})
it("focuses cancel when closing an edited draft and preserves the edits on cancellation", async () => {
  await setup({ ...draft, subject: "原主题" })
  act(() => { input("subject")!.focus(); model.edit({ subject: "未保存的主题" }) })
  await act(async () => { await model.close() }); await flush()
  const dialog = document.querySelector('[role="alertdialog"]')!
  const cancel = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "取消")!
  expect(document.activeElement).toBe(cancel)
  act(() => cancel.click()); await flush()
  expect(model.closeRequested).toBe(false)
  await vi.waitFor(() => expect(document.activeElement).toBe(input("subject")))
  expect(input("subject")?.value).toBe("未保存的主题")
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
})
it.each(["javascript:alert(1)", "not-a-url"])("keeps link validation for %s inside the dialog and discards it when cancelled", async invalidLink => {
  await setup()
  act(() => button("插入链接").click())
  const link = input("link")!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(link, invalidLink)
    link.dispatchEvent(new Event("input", { bubbles: true }))
  })
  act(() => [...document.querySelectorAll("button")].find(node => node.textContent === "应用")!.click())
  expect(link.getAttribute("aria-invalid")).toBe("true")
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("请输入有效的网页或邮箱链接")
  act(() => [...dialog.querySelectorAll("button")].find(node => node.textContent === "关闭")!.click())
  expect(document.querySelector('[role="alert"]')).toBeNull()
  act(() => button("插入链接").click())
  expect(input("link")?.value).toBe("")
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
