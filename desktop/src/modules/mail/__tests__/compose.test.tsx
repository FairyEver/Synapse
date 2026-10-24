/** @vitest-environment jsdom */
import { mocks, mount, flush, deferred } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { useCompose } from "../use-compose"
import { runAppNavigation } from "@/app-shell/navigation-guard"
const draft = { id: "md_draft", accountId: "ma_one", revision: 1, to: [{ address: "to@example.com" }], cc: [], bcc: [], subject: "主题", html: "<p>正文</p>", text: "正文", assetIds: [], inlineImages: [], state: "editing" as const, mode: "new" as const, sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "pending" as const, updatedAt: "2026-10-23T00:00:00Z" }
let editor: ReturnType<typeof useCompose>
function Harness() { editor = useCompose(mocks.owner); return null }
async function setup() {
  for (const name of ["draftGet", "draftCreate", "draftUpdate", "sendPreview", "messageSend", "operationGet"]) mocks.api[name] = vi.fn()
  mocks.api.draftGet.mockResolvedValue(draft); mocks.api.draftCreate.mockResolvedValue(draft)
  mocks.api.draftUpdate.mockImplementation(async ({ expectedRevision, patch }) => ({ ...draft, ...patch, revision: expectedRevision + 1 }))
  mocks.api.sendPreview.mockResolvedValue({ previewId: "mp_preview", draft, from: { address: "me@example.com" }, attachments: [], expiresAt: "2026-10-23T01:00:00Z", messageId: "<test@example.com>" })
  mount(<Harness />); await flush(); await act(async () => { await editor.open({ draftId: draft.id }) })
}
afterEach(() => vi.useRealTimers())
it("clears hidden Bcc recipients only on explicit save before preparing a send", async () => {
  await setup(); await act(async () => { await editor.close() })
  mocks.api.draftGet.mockResolvedValueOnce({ ...draft, bcc: [{ address: "hidden@example.com" }] })
  await act(async () => { await editor.open({ draftId: draft.id }) })
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
  mocks.api.messageSend.mockResolvedValueOnce({ operationId: "mo_send", state: "accepted", accepted: [draft.to[0].address], rejected: [], sentCopyState: "saved", errorCode: null })
  await act(async () => { await editor.send() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ to: draft.to, bcc: [] }) }))
  expect(mocks.api.draftUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.sendPreview.mock.invocationCallOrder[0])
  expect(editor.receipt?.state).toBe("accepted")
})
it("does not autosave and asks before closing dirty edits", async () => {
  await setup(); vi.useFakeTimers()
  act(() => editor.edit({ subject: "新主题" }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
  await act(async () => { await editor.close() })
  expect(editor.closeRequested).toBe(true)
  expect(editor.draft?.subject).toBe("新主题")
  mocks.api.draftUpdate.mockRejectedValueOnce(new Error("连接断开"))
  await act(async () => { await editor.resolveClose("save") })
  expect(editor.draft?.subject).toBe("新主题"); expect(editor.error).toBe("连接断开")
  await act(async () => { await editor.resolveClose("discard") })
  expect(editor.draft).toBeNull()
})
it("serializes double send and keeps partial/unknown receipts without automatically retrying", async () => {
  await setup()
  const pending = deferred<{ operationId: string; state: string; accepted: string[]; rejected: string[]; sentCopyState: string; errorCode: null }>()
  mocks.api.messageSend.mockReturnValue(pending.promise)
  let sending!: Promise<void>
  act(() => { sending = editor.send(); void editor.send() })
  await flush(); expect(mocks.api.messageSend).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({ operationId: "mo_operation", state: "partial", accepted: ["to@example.com"], rejected: ["other@example.com"], sentCopyState: "saved", errorCode: null }); await sending })
  expect(editor.receipt?.state).toBe("partial"); expect(editor.draft?.state).toBe("consumed")
  await act(async () => { await editor.send() }); expect(mocks.api.messageSend).toHaveBeenCalledTimes(1)
})
it("preserves concurrent local edits when a save receipt arrives late", async () => {
  await setup(); const pending = deferred<typeof draft>(); mocks.api.draftUpdate.mockReturnValueOnce(pending.promise)
  act(() => editor.edit({ subject: "first" })); let save!: Promise<void>; act(() => { save = editor.save() })
  act(() => editor.edit({ subject: "newest" }))
  await act(async () => { pending.resolve({ ...draft, subject: "first", revision: 2 }); await save })
  expect(editor.draft?.subject).toBe("newest")
})

it("does not show a copied draft after switching SY identity", async () => {
  await setup(); const pending = deferred<typeof draft>(); mocks.api.draftCreate.mockReturnValueOnce(pending.promise)
  let copy!: Promise<void>; act(() => { copy = editor.copyDraft() })
  mocks.owner = "other"; mount(<Harness />); await flush()
  await act(async () => { pending.resolve({ ...draft, id: "md_late" }); await copy })
  expect(editor.draft).toBeNull()
})
it("can correct an invalid address after a failed save", async () => {
  await setup(); act(() => editor.changeAddress("to", "bad-address"))
  await act(async () => { await editor.close() }); expect(editor.draft).not.toBeNull()
  act(() => editor.changeAddress("to", "valid@example.com"))
  await act(async () => { await editor.save() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ to: [{ address: "valid@example.com" }] }) }))
})
it("explains invalid recipients without exposing schema internals and clears the error on correction", async () => {
  await setup(); act(() => editor.changeAddress("cc", "not-an-email"))
  await act(async () => { await expect(editor.save()).rejects.toThrow("抄送地址格式无效") })
  expect(editor.error).toBe("抄送地址格式无效，请检查邮箱地址，并用逗号或分号分隔")
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
  act(() => editor.changeAddress("cc", "copy@example.com"))
  expect(editor.error).toBeNull()
  await act(async () => { await editor.save() })
  expect(editor.draft?.cc).toEqual([{ address: "copy@example.com" }])
})
it("keeps unknown send results for read-only reconciliation without resubmission", async () => {
  await setup(); const unknown = { operationId: "mo_unknown", state: "unknown", accepted: [], rejected: [], sentCopyState: "unknown", errorCode: "NETWORK_ERROR" }
  mocks.api.messageSend.mockResolvedValue(unknown); mocks.api.operationGet.mockResolvedValue(unknown)
  await act(async () => { await editor.send() }); await act(async () => { await editor.send(); await editor.reconcile() })
  expect(editor.receipt?.state).toBe("unknown"); expect(mocks.api.messageSend).toHaveBeenCalledTimes(1)
  expect(mocks.api.operationGet).toHaveBeenCalledWith({ operationId: "mo_unknown" })
})

it("roundtrips comma, quoted and multilingual display names while saving a reply", async () => {
  await setup(); await act(async () => { await editor.close() })
  const to = [{ address: "john@example.com", name: "Doe, John" }, { address: "cn@example.com", name: '张三; \"同事\"' }]
  mocks.api.draftGet.mockResolvedValueOnce({ ...draft, to })
  await act(async () => { await editor.open({ draftId: draft.id }) })
  act(() => editor.edit({ subject: "修改正文也能保存" }))
  await act(async () => { await editor.save() })
  expect(mocks.api.draftUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ patch: expect.objectContaining({ to }) }))
})

it("does not silently save during navigation", async () => {
  await setup(); act(() => editor.edit({ subject: "keep" }))
  const leave = vi.fn()
  await act(async () => { expect(await runAppNavigation(leave)).toBe(false) })
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled(); expect(leave).not.toHaveBeenCalled()
})
it("closes a pending preparation and ignores late results without creating a draft", async () => {
  await setup(); await act(async () => { await editor.close() })
  const pending = deferred<typeof draft>(); mocks.api.draftPrepare = vi.fn().mockReturnValue(pending.promise)
  let opening!: Promise<void>; act(() => { opening = editor.open({ accountId: "ma_one", sourceMessageId: "em_source", mode: "reply" }) })
  await act(async () => { expect(await editor.close()).toBe(true) })
  await act(async () => { pending.resolve({ ...draft, localSaved: false }); await opening })
  expect(editor.draft).toBeNull(); expect(editor.loading).toBe(false)
  expect(mocks.api.draftCreate).not.toHaveBeenCalled()
})
it("new empty mail only becomes persistent on explicit save", async () => {
  await setup(); await act(async () => { await editor.close() })
  mocks.api.draftPrepare = vi.fn().mockResolvedValue({ ...draft, subject: "", text: "", html: "", to: [], localSaved: false })
  mocks.api.draftCommit = vi.fn().mockImplementation(async ({ content }) => ({ ...draft, ...content, localSaved: true }))
  await act(async () => { await editor.open({ accountId: "ma_one" }) })
  expect(mocks.api.draftCreate).not.toHaveBeenCalled(); expect(mocks.api.draftCommit).not.toHaveBeenCalled()
  act(() => editor.edit({ subject: "saved" }))
  await act(async () => { await editor.save() })
  expect(mocks.api.draftCommit).toHaveBeenCalledTimes(1)
  act(() => editor.edit({ subject: "later" }))
  await act(async () => { await editor.save() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledTimes(1)
})

it("retains an attachment arriving after the first save changes the persistent draft ID", async () => {
  await setup(); await act(async () => { await editor.close() })
  mocks.api.draftPrepare = vi.fn().mockResolvedValue({ ...draft, localSaved: false })
  mocks.api.draftCommit = vi.fn().mockResolvedValue({ ...draft, id: "md_saved" })
  const pending = deferred<Array<{ id: string }>>()
  mocks.api.pickAttachments = vi.fn().mockReturnValue(pending.promise)
  await act(async () => { await editor.open({ accountId: draft.accountId }) })
  let importing!: Promise<void>; act(() => { importing = editor.pickAttachments() })
  await act(async () => { await editor.save() })
  await act(async () => { pending.resolve([{ id: "mas_attachment" }]); await importing })
  expect(editor.draft?.assetIds).toEqual(["mas_attachment"])
  expect(editor.dirty).toBe(true)
})
it("supports native close cancellation and discards edits without rewriting an existing draft", async () => {
  await setup(); act(() => editor.edit({ subject: "unsaved" }))
  const event = new Event("beforeunload", { cancelable: true })
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true); expect(editor.closeRequested).toBe(true)
  await act(async () => { await editor.resolveClose("cancel") })
  expect(editor.closeRequested).toBe(false); expect(editor.draft?.subject).toBe("unsaved")
  await act(async () => { await editor.resolveClose("discard") })
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
  expect(editor.draft).toBeNull()
})

it("closes without prompting after all edits are restored to the saved content", async () => {
  await setup()
  act(() => { editor.edit({ subject: "临时主题" }); editor.changeAddress("to", "other@example.com") })
  act(() => { editor.edit({ subject: draft.subject }); editor.changeAddress("to", "to@example.com") })
  expect(editor.dirty).toBe(false)
  const leave = vi.fn()
  await act(async () => { expect(await runAppNavigation(leave)).toBe(true) })
  expect(leave).toHaveBeenCalledTimes(1)
  const event = new Event("beforeunload", { cancelable: true })
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  await act(async () => { expect(await editor.close()).toBe(true) })
  expect(editor.closeRequested).toBe(false)
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
})

it("does not mark repeated identical updates as unsaved edits", async () => {
  await setup()
  act(() => { editor.edit({ html: draft.html, text: draft.text }); editor.changeAddress("to", "to@example.com") })
  expect(editor.dirty).toBe(false)
  await act(async () => { expect(await editor.close()).toBe(true) })
  expect(editor.closeRequested).toBe(false)
})

it("closes without prompting when edits leave only whitespace and empty formatting", async () => {
  await setup()
  act(() => {
    editor.changeAddress("to", " \n "); editor.changeAddress("cc", " ")
    editor.edit({ subject: " \t ", text: "", html: "<p><strong> &nbsp; </strong><br></p>" })
  })
  const event = new Event("beforeunload", { cancelable: true })
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  const leave = vi.fn()
  await act(async () => { expect(await runAppNavigation(leave)).toBe(true) })
  await act(async () => { expect(await editor.close()).toBe(true) })
  expect(editor.closeRequested).toBe(false)
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
})

it.each([
  { name: "recipient", patch: {}, to: "new@example.com", cc: "" },
  { name: "Cc recipient", patch: {}, to: "", cc: "copy@example.com" },
  { name: "subject", patch: { subject: "新主题" }, to: "", cc: "" },
  { name: "body", patch: { html: "<p>新正文</p>", text: "新正文" }, to: "", cc: "" },
  { name: "attachment", patch: { assetIds: ["mas_attachment"] }, to: "", cc: "" },
  { name: "inline image", patch: { html: '<p><img src="cid:image@local"></p>', inlineImages: [{ assetId: "mas_image", cid: "image@local" }] }, to: "", cc: "" },
])("prompts before discarding a changed $name even without other content", async ({ patch, to, cc }) => {
  await setup(); await act(async () => { await editor.close() })
  mocks.api.draftPrepare = vi.fn().mockResolvedValue({ ...draft, to: [], subject: "", text: "", html: "", localSaved: false })
  await act(async () => { await editor.open({ accountId: draft.accountId }) })
  act(() => { editor.changeAddress("to", to); editor.changeAddress("cc", cc); editor.edit(patch) })
  const event = new Event("beforeunload", { cancelable: true })
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  await act(async () => { expect(await editor.close()).toBe(false) })
  expect(editor.closeRequested).toBe(true)
})

it("uses the most recent explicit save as the comparison baseline", async () => {
  await setup()
  act(() => editor.edit({ subject: "已保存主题" }))
  await act(async () => { await editor.save() })
  act(() => { editor.edit({ subject: "临时修改" }); editor.edit({ subject: "已保存主题" }) })
  expect(editor.dirty).toBe(false)
  await act(async () => { expect(await editor.close()).toBe(true) })
  expect(mocks.api.draftUpdate).toHaveBeenCalledTimes(1)
})

it("ignores unused image metadata after an inserted image is removed", async () => {
  await setup()
  act(() => editor.edit({ html: '<p>正文<img src="cid:image@local"></p>', inlineImages: [{ assetId: "mas_image", cid: "image@local" }] }))
  expect(editor.dirty).toBe(true)
  act(() => editor.edit({ html: draft.html, text: draft.text }))
  expect(editor.dirty).toBe(false)
  await act(async () => { expect(await editor.close()).toBe(true) })
  expect(editor.closeRequested).toBe(false)
})

it("retains an image arriving after first save without saving it implicitly", async () => {
  await setup(); await act(async () => { await editor.close() })
  mocks.api.draftPrepare = vi.fn().mockResolvedValue({ ...draft, localSaved: false })
  mocks.api.draftCommit = vi.fn().mockResolvedValue({ ...draft, id: "md_saved" })
  const pending = deferred<{ id: string }>()
  mocks.api.imageImport = vi.fn().mockReturnValue(pending.promise)
  await act(async () => { await editor.open({ accountId: draft.accountId }) })
  const session = editor.sessionId
  let importing!: ReturnType<typeof editor.importImage>
  act(() => { importing = editor.importImage({ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer } as File) })
  await flush()
  await act(async () => { await editor.save() })
  await act(async () => { pending.resolve({ id: "mas_image" }); expect(await importing).toMatchObject({ assetId: "mas_image" }) })
  expect(editor.sessionId).toBe(session)
  expect(editor.draft?.inlineImages).toHaveLength(1)
  const image = editor.draft!.inlineImages[0]
  act(() => editor.edit({ html: `<p>正文<img src="cid:${image.cid}"></p>` }))
  expect(editor.dirty).toBe(true)
  expect(mocks.api.draftCommit).toHaveBeenCalledTimes(1)
  expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
})

it("adds reviewed department addresses to the latest draft, requiring explicit exclusions", async () => {
  await setup()
  const members = [{ userId: "one", name: "成员", address: { name: "成员", address: "member@example.com" }, issue: null }, { userId: "two", name: "新人", address: null, issue: "未设置联系邮箱" }]
  act(() => editor.changeAddress("cc", "member@example.com,manual@example.com"))
  expect(() => editor.addDepartmentRecipients("to", members, false)).toThrow("请先处理")
  expect(editor.addresses.cc).toContain("member@example.com")
  act(() => editor.addDepartmentRecipients("to", members, true))
  expect(editor.addresses.cc).toBe("manual@example.com")
  await act(async () => { await editor.save() })
  expect(mocks.api.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ to: [draft.to[0], members[0].address], cc: [{ address: "manual@example.com" }] }) }))
})

it("prepares a new unsaved message with the chosen recipient and no reply content", async () => {
  const recipient = { name: 'Doe, John', address: "john@example.com" }
  mocks.api.draftPrepare = vi.fn(async input => ({ ...draft, ...input, subject: "", html: "", text: "", localSaved: false }))
  mocks.api.draftCommit = vi.fn()
  mount(<Harness />); await flush()
  await act(async () => { await editor.open({ accountId: "ma_one", recipient }) })
  expect(mocks.api.draftPrepare).toHaveBeenCalledExactlyOnceWith({ accountId: "ma_one", to: [recipient] })
  expect(editor.draft).toMatchObject({ to: [recipient], subject: "", html: "", text: "", mode: "new", sourceMessageId: null })
  expect(editor.addresses.to).toBe('"Doe, John" <john@example.com>')
  expect(mocks.api.draftCommit).not.toHaveBeenCalled()
})
