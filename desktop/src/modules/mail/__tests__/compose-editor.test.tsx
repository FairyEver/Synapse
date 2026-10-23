/** @vitest-environment jsdom */
import { mocks, mount, flush } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { EditorContent } from "@tiptap/react"
import { useCompose } from "../use-compose"
import { useComposeEditor } from "../use-compose-editor"
let model: ReturnType<typeof useCompose>, rich: ReturnType<typeof useComposeEditor>
function Harness() { model = useCompose("user"); rich = useComposeEditor(model); return <EditorContent editor={rich.editor} /> }
afterEach(() => vi.useRealTimers())
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
