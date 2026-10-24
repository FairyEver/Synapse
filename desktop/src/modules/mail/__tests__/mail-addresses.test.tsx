/** @vitest-environment jsdom */
import { mount, detail } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { toast } from "sonner"
import { MailAddresses, mailDelegates } from "../mail-addresses"
import { MailDetail } from "../message-detail"

it("shows original names, reveals and copies the exact address without interpreting group membership", async () => {
  const address = "opaque_party_rd_dm@wecom.work"
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  mount(<MailAddresses onCompose={vi.fn()} addresses={[{ name: "设计中心 · 16", address }, { address: "person@example.com" }]} />)
  expect(document.body.textContent).toContain("设计中心 · 16")
  expect(document.body.textContent).not.toContain(address)
  expect(document.body.textContent).toContain("person@example.com")
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="设计中心 · 16，查看邮箱地址"]')!.click() })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(address)
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="复制邮箱地址"]')!.click() })
  expect(writeText).toHaveBeenCalledExactlyOnceWith(address)
  expect(document.body.textContent).toContain("写邮件")
})

it("reports failed address copies", async () => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => 1)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
  mount(<MailAddresses onCompose={vi.fn()} addresses={[{ address: "person@example.com" }]} />)
  await act(async () => { document.querySelector('button')!.click() })
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="复制邮箱地址"]')!.click() })
  expect(error).toHaveBeenCalledWith("复制失败")
  error.mockRestore()
})

it("shows a distinct sender without removing recipients or changing reply actions", () => {
  const onReply = vi.fn()
  const mail = { ...detail, to: [{ name: "原发件人", address: "deliver_to_message_example@wecom.work" }, { name: "收件人", address: "recipient@example.com" }], cc: [{ name: "开发中心 · 18", address: "team@example.com" }], headers: { ...detail.headers, sender: [{ name: "代发者", address: "relay@example.com" }] } }
  mount(<MailDetail onCompose={() => undefined} detail={mail} body={null} resources={{ cid: {}, remote: {} }} onBack={vi.fn()} onResource={vi.fn()} onDownload={vi.fn()} onLink={vi.fn()} onReply={onReply} onCopy={vi.fn()} />)
  expect(document.body.textContent).toContain("代发")
  for (const name of ["原发件人", "收件人", "开发中心 · 18", "relay@example.com"]) expect(document.body.textContent).toContain(name)
  act(() => [...document.querySelectorAll('button')].find(b => b.textContent === "回复")!.click())
  expect(onReply).toHaveBeenCalledExactlyOnceWith("reply")
  expect(mail.to).toHaveLength(2)
  expect(mailDelegates([{ address: "AUTHOR@example.com" }], [{ address: "author@example.com" }])).toEqual([])
  expect(mailDelegates(mail.from)).toEqual([])
})
