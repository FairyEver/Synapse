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
