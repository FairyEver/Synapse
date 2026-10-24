/** @vitest-environment jsdom */
import { mocks, mount, flush, deferred } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { EditorContent } from "@tiptap/react"
import { useCompose } from "../use-compose"
import { useComposeEditor } from "../use-compose-editor"
let model: ReturnType<typeof useCompose>, rich: ReturnType<typeof useComposeEditor>
function Harness() { model = useCompose("user"); rich = useComposeEditor(model); return <EditorContent editor={rich.editor} /> }
afterEach(() => vi.useRealTimers())
it.each([
  { name: "mail from a contact address", mode: "new", recipient: true, localSaved: false, state: "editing", focused: true },
  { name: "forward without recipients", mode: "forward", recipient: false, localSaved: false, state: "editing", focused: true },
  { name: "saved draft without recipients", mode: "new", recipient: false, localSaved: true, state: "editing", focused: true },
  { name: "blank new mail", mode: "new", recipient: false, localSaved: false, state: "editing", focused: false },
  { name: "sent draft", mode: "new", recipient: true, localSaved: true, state: "consumed", focused: false },
] as const)("sets initial body focus for $name", async ({ mode, recipient, localSaved, state, focused }) => {
  const address = { address: "contact@example.com" }
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: recipient ? [address] : [], cc: [], bcc: [], subject: "", html: "<p>已有正文</p>", text: "已有正文", assetIds: [], inlineImages: [], state, mode, sourceMessageId: mode === "forward" ? "em_one" : null, remoteLocator: null, localSaved, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  mocks.api.draftPrepare = vi.fn().mockResolvedValue(draft)
  mocks.api.draftGet = vi.fn().mockResolvedValue(draft)
  mount(<Harness />); await flush()
  await act(async () => {
    await model.open(localSaved ? { draftId: draft.id } : mode === "forward" ? { accountId: draft.accountId, sourceMessageId: "em_one", mode } : { accountId: draft.accountId, ...(recipient ? { recipient: address } : {}) })
  }); await flush()
  await act(async () => { await new Promise(requestAnimationFrame) })
  expect(document.activeElement === rich.editor!.view.dom).toBe(focused)
  if (focused) {
    expect(rich.editor!.state.selection.from).toBe(1)
    expect(rich.editor!.state.selection.empty).toBe(true)
  }
  expect(model.dirty).toBe(false)
})
it.each(["reply", "reply_all"] as const)("focuses the body start after %s finishes loading without resetting focus on edits", async mode => {
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: [{ address: "sender@example.com" }], cc: [], bcc: [], subject: "Re: 主题", html: "<p></p><blockquote><p>原邮件正文</p></blockquote>", text: "原邮件正文", assetIds: [], inlineImages: [], state: "editing", mode, sourceMessageId: "em_one", remoteLocator: null, localSaved: false, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  const pending = deferred<typeof draft>()
  mocks.api.draftPrepare = vi.fn().mockReturnValue(pending.promise)
  mount(<Harness />); await flush()
  let opening!: Promise<void>
  act(() => { opening = model.open({ accountId: draft.accountId, sourceMessageId: draft.sourceMessageId, mode }) })
  expect(document.activeElement).not.toBe(rich.editor!.view.dom)
  await act(async () => { pending.resolve(draft); await opening }); await flush()
  await act(async () => { await new Promise(requestAnimationFrame) })
  expect(document.activeElement).toBe(rich.editor!.view.dom)
  expect(rich.editor!.state.selection.from).toBe(1)
  expect(rich.editor!.state.selection.empty).toBe(true)
  expect(model.dirty).toBe(false)
  act(() => { rich.editor!.commands.insertContent("回复内容") })
  expect(model.draft?.html).toContain("<p>回复内容</p><blockquote>")
  const caret = rich.editor!.state.selection.from
  const subject = document.createElement("input")
  document.body.append(subject)
  act(() => { subject.focus(); model.edit({ subject: "Re: 新主题" }) })
  await act(async () => { await new Promise(requestAnimationFrame) })
  expect(document.activeElement).toBe(subject)
  expect(rich.editor!.state.selection.from).toBe(caret)
})
it.each([
  { name: "empty new mail", html: "", text: "", localSaved: false },
  { name: "an existing draft", html: "<p>正文</p>", text: "正文", localSaved: true },
])("closes $name without a prompt after editor initialization", async ({ html, text, localSaved }) => {
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "", html, text, assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  mocks.api.draftGet = vi.fn().mockResolvedValue(draft)
  mocks.api.draftPrepare = vi.fn().mockResolvedValue(draft)
  mount(<Harness />); await flush()
  await act(async () => { await model.open(localSaved ? { draftId: draft.id } : { accountId: draft.accountId }) }); await flush()
  expect(model.dirty).toBe(false)
  const event = new Event("beforeunload", { cancelable: true })
  act(() => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  await act(async () => { expect(await model.close()).toBe(true) })
  expect(model.closeRequested).toBe(false)
})
it.each([
  { name: "empty body", html: "", text: "" },
  { name: "existing rich text", html: "<p><b>正文</b></p>", text: "正文" },
])("closes after undo restores $name", async ({ html, text }) => {
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "", html, text, assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: false, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  mocks.api.draftPrepare = vi.fn().mockResolvedValue(draft)
  mount(<Harness />); await flush()
  await act(async () => { await model.open({ accountId: draft.accountId }) }); await flush()
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 1000)
  act(() => { rich.editor!.commands.insertContent("临时正文") })
  expect(model.dirty).toBe(true)
  act(() => { rich.editor!.commands.undo() })
  expect(rich.editor!.getText()).toBe(text)
  expect(model.dirty).toBe(false)
  await act(async () => { expect(await model.close()).toBe(true) })
  expect(model.closeRequested).toBe(false)
})
it("keeps basic formats and has a single link/underline extension while stripping active pasted HTML", async () => {
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "", html: "<p>正文</p>", text: "正文", assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  mocks.api.draftGet = vi.fn().mockResolvedValue(draft)
  mount(<Harness />); await flush(); await act(async () => { await model.open({ draftId: "md_one" }) }); await flush()
  expect(rich.editor).toBeTruthy()
  const names = rich.editor!.extensionManager.extensions.map(extension => extension.name)
  expect(names.filter(name => name === "link")).toHaveLength(1); expect(names.filter(name => name === "underline")).toHaveLength(1)
  const transform = rich.editor!.options.editorProps?.transformPastedHTML!
  const safe = transform.call(rich.editor!.view, '<script>bad()</script><img src="https://tracker"><p><strong>粗体</strong><u>下划线</u><span style="font-size:18px;background:url(https://tracker)">字号</span></p>', rich.editor!.view)
  expect(safe).not.toMatch(/script|https:|background/iu)
  act(() => { rich.editor!.commands.setContent(safe, { emitUpdate: true }) })
  expect(model.currentDraft()?.html).toContain("<strong>粗体</strong>"); expect(model.currentDraft()?.html).toContain("<u>下划线</u>")
  expect(model.currentDraft()?.html).toContain("font-size: 18px")
})
it("updates active format controls when a toolbar command changes stored marks without moving the caret", async () => {
  const draft = { id: "md_one", accountId: "ma_one", revision: 1, to: [], cc: [], bcc: [], subject: "", html: "<p>正文</p>", text: "正文", assetIds: [], inlineImages: [], state: "editing", mode: "new", sourceMessageId: null, remoteLocator: null, localSaved: true, syncState: "pending", updatedAt: "2026-10-23T00:00:00Z" }
  mocks.api.draftGet = vi.fn().mockResolvedValue(draft)
  mount(<Harness />); await flush(); await act(async () => { await model.open({ draftId: draft.id }) }); await flush()
  act(() => { rich.editor!.commands.setTextSelection(2) })
  act(() => { rich.editor!.commands.toggleBold() })
  expect(rich.activeMarks).toContain("bold")
  act(() => { rich.editor!.commands.insertContent("B") })
  expect(model.draft?.html).toContain("<strong>B</strong>")
  act(() => { rich.editor!.commands.toggleBold() })
  expect(rich.activeMarks).not.toContain("bold")
})
