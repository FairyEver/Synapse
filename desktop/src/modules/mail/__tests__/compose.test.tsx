/** @vitest-environment jsdom */
import { mocks, mount, flush, deferred } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { useCompose } from "../use-compose"
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
it("saves after one idle second and refuses to close after a save failure", async () => {
  await setup(); vi.useFakeTimers()
  act(() => editor.edit({ subject: "新主题" })); await act(async () => { await vi.advanceTimersByTimeAsync(999) }); expect(mocks.api.draftUpdate).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) }); expect(mocks.api.draftUpdate).toHaveBeenCalledTimes(1)
  mocks.api.draftUpdate.mockRejectedValueOnce(new Error("连接断开"))
  act(() => editor.edit({ text: "保留内容", html: "<p>保留内容</p>" }))
  let closed = true; await act(async () => { closed = await editor.close() })
  expect(closed).toBe(false); expect(editor.draft?.text).toBe("保留内容"); expect(editor.error).toBe("连接断开")
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
it("keeps unknown send results for read-only reconciliation without resubmission", async () => {
  await setup(); const unknown = { operationId: "mo_unknown", state: "unknown", accepted: [], rejected: [], sentCopyState: "unknown", errorCode: "NETWORK_ERROR" }
  mocks.api.messageSend.mockResolvedValue(unknown); mocks.api.operationGet.mockResolvedValue(unknown)
  await act(async () => { await editor.send() }); await act(async () => { await editor.send(); await editor.reconcile() })
  expect(editor.receipt?.state).toBe("unknown"); expect(mocks.api.messageSend).toHaveBeenCalledTimes(1)
  expect(mocks.api.operationGet).toHaveBeenCalledWith({ operationId: "mo_unknown" })
})
