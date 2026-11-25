// @vitest-environment jsdom
import { account, flush, mocks, mount } from "./harness"
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { MailSchedulePickerDialog } from "../schedule-picker-dialog"
import { ExternalMailModule } from "../index"

const scheduledSummary = {
  id: "ms_e69940c0-4db1-4a0a-8f87-9027d116e194",
  accountId: "ma_one",
  draftId: "md_e69940c0-4db1-4a0a-8f87-9027d116e194",
  revision: 1,
  state: "pending" as const,
  sendAt: "2027-06-15T06:30:00.000Z",
  graceMs: 30 * 60_000,
  from: { address: "me@example.com" },
  to: [{ address: "alice@example.com", name: "Alice" }],
  cc: [],
  bcc: [],
  subject: "明年年中汇报",
  attachmentCount: 0,
  messageId: "<sched-1@synapse.local>",
  operationId: null,
  errorCode: null,
  createdAt: "2026-11-25T03:00:00.000Z",
  updatedAt: "2026-11-25T03:00:00.000Z",
  sentAt: null,
}

const scheduledDetail = {
  ...scheduledSummary,
  attachments: [],
  bodyRef: "mas_e69940c0-4db1-4a0a-8f87-9027d116e194",
  receipt: null,
}

describe("external mail scheduled UI", () => {
  it("allows selecting a specific future date and time, and rejects past times", async () => {
    const onConfirm = vi.fn<(sendAtIso: string) => Promise<void>>(async () => undefined)
    const onOpenChange = vi.fn()
    mount(
      <MailSchedulePickerDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )
    await flush()

    const dateInput = document.body.querySelector('input[type="date"]') as HTMLInputElement
    const timeInput = document.body.querySelector('input[type="time"]') as HTMLInputElement
    const form = document.body.querySelector("form") as HTMLFormElement
    expect(dateInput).toBeTruthy()
    expect(timeInput).toBeTruthy()

    // Enter a past date and submit -> blocked with accessible error
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
      setter.call(dateInput, "2020-01-01")
      dateInput.dispatchEvent(new Event("input", { bubbles: true }))
      setter.call(timeInput, "09:00")
      timeInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("发送时间必须晚于当前时间")

    // Enter a specific future date and time -> succeeds with valid ISO timestamp
    act(() => {
      setter.call(dateInput, "2027-06-15")
      dateInput.dispatchEvent(new Event("input", { bubbles: true }))
      setter.call(timeInput, "14:30")
      timeInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const submittedIso = onConfirm.mock.calls[0][0]
    const submitted = new Date(submittedIso)
    expect(submitted.getFullYear()).toBe(2027)
    expect(submitted.getMonth()).toBe(5)
    expect(submitted.getDate()).toBe(15)
    expect(submitted.getHours()).toBe(14)
    expect(submitted.getMinutes()).toBe(30)
  })

  it("navigates to scheduled sends view, displays detail and cancels back to drafts", async () => {
    mocks.api.accountList.mockResolvedValue({ items: [{ ...account, aliases: [] }], nextCursor: null })
    mocks.api.scheduledList.mockResolvedValue({ items: [scheduledSummary], nextCursor: null })
    mocks.api.scheduledGet.mockResolvedValue(scheduledDetail)
    mocks.api.scheduledCancel.mockResolvedValue({ ...scheduledDetail, state: "cancelled", revision: 2 })

    mount(<ExternalMailModule />)
    await flush()

    const navButton = [...document.querySelectorAll("nav button")].find(btn => btn.textContent?.includes("定时发送")) as HTMLButtonElement
    expect(navButton).toBeTruthy()
    act(() => { navButton.click() })
    await flush()

    expect(mocks.api.scheduledList).toHaveBeenCalledWith(expect.objectContaining({ accountId: "ma_one" }))
    const rowButton = [...document.querySelectorAll("button")].find(btn => btn.textContent?.includes("明年年中汇报")) as HTMLButtonElement
    expect(rowButton).toBeTruthy()

    act(() => { rowButton.click() })
    await flush()

    expect(mocks.api.scheduledGet).toHaveBeenCalledWith({ scheduledId: scheduledSummary.id })
    expect(mocks.api.scheduledBody).toHaveBeenCalledWith({ scheduledId: scheduledSummary.id })
    const iframe = document.querySelector("iframe")
    expect(iframe?.getAttribute("srcdoc")).toContain("定时正文")

    const cancelButton = [...document.querySelectorAll("button")].find(btn => btn.textContent?.trim() === "取消定时") as HTMLButtonElement
    expect(cancelButton).toBeTruthy()
    act(() => { cancelButton.click() })
    await flush()

    expect(mocks.api.scheduledCancel).toHaveBeenCalledWith({
      scheduledId: scheduledSummary.id,
      expectedRevision: 1,
      restoreDraft: true,
    })
  })
})
