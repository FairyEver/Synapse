/** @vitest-environment jsdom */
import { mocks, mount, flush } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { EditorContent } from "@tiptap/react"
import { useCompose } from "../use-compose"
import { useComposeEditor } from "../use-compose-editor"
let model: ReturnType<typeof useCompose>, rich: ReturnType<typeof useComposeEditor>
function Harness() { model = useCompose("user"); rich = useComposeEditor(model); return <EditorContent editor={rich.editor} /> }
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
