import { useEffect, useRef, useState } from "react"
import { useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import { TextStyle, FontSize } from "@tiptap/extension-text-style"
import { sanitizeComposeDocument } from "../../../app-capabilities/mail/renderer/compose-document"
import { mailApi, mailError } from "./api"
import type { ComposeModel } from "./use-compose"
const empty = { to: "", cc: "" }
export function useComposeEditor(model: ComposeModel) {
  const latest = useRef(model); latest.current = model
  const [error, setError] = useState<string | null>(null), [activeMarks, setActiveMarks] = useState<string[]>([])
  const [linkOpen, setLinkOpen] = useState(false), [link, changeLink] = useState("")
  const initialBody = useRef<{ json: string; html: string; text: string } | null>(null)
  const currentSession = useRef(model.sessionId); currentSession.current = model.sessionId
  const imageExtension = useRef(Image.extend({
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("img"), source = String(node.attrs.src ?? ""), draft = latest.current.currentDraft(), session = currentSession.current
        dom.alt = "邮件图片"; let alive = true, url: string | undefined
        const image = draft?.inlineImages.find(image => source === `cid:${image.cid}`)
        if (draft && image) {
          void mailApi().composeImageAsset({ accountId: draft.accountId, assetId: image.assetId }).then(result => {
            if (!alive || currentSession.current !== session) return
            const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
            url = URL.createObjectURL(new Blob([bytes], { type: result.mime })); dom.src = url
          }).catch(cause => { if (alive && currentSession.current === session) setError(mailError(cause)) })
        }
        return { dom, destroy() { alive = false; if (url) URL.revokeObjectURL(url) } }
      }
    },
  }).configure({ allowBase64: false }))
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, code: false, codeBlock: false, horizontalRule: false, link: { openOnClick: false, autolink: false } }), TextStyle, FontSize, imageExtension.current],
    content: "", editable: false,
    editorProps: {
      attributes: { class: "min-h-64 p-4 text-sm outline-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l [&_blockquote]:pl-3 [&_p]:my-2 [&_img]:max-w-full", "aria-label": "邮件正文", role: "textbox", "aria-multiline": "true" },
      transformPastedHTML: html => sanitizeComposeDocument(html, latest.current.currentDraft()?.inlineImages ?? []).html,
      handlePaste(_view, event) {
        const images = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith("image/"))
        if (!images.length) return false
        event.preventDefault(); void insertImages(images); return true
      },
    },
    onUpdate({ editor }) {
      const draft = latest.current.currentDraft()
      if (!draft) return
      try {
        const initial = initialBody.current
        // 编辑器会规范化标签；撤销回加载时的文档不应被视为正文修改。
        const safe = initial?.json === JSON.stringify(editor.getJSON()) ? { html: initial.html, text: initial.text } : sanitizeComposeDocument(editor.getHTML(), draft.inlineImages)
        latest.current.edit(safe)
      } catch (cause) { setError(mailError(cause)) }
    },
    onTransaction({ editor }) { setActiveMarks(["bold", "italic", "underline", "bulletList", "orderedList"].filter(mark => editor.isActive(mark))) },
  })
  useEffect(() => {
    const draft = model.draft
    setError(null)
    if (editor) {
      const body = draft ? sanitizeComposeDocument(draft.html || draft.text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/\n/gu, "<br>"), draft.inlineImages) : { html: "", text: "" }
      editor.commands.setContent(body.html, { emitUpdate: false })
      initialBody.current = { ...body, json: JSON.stringify(editor.getJSON()) }
    }
  }, [editor, model.sessionId, !!model.draft])
  useEffect(() => { editor?.setEditable(model.draft?.state === "editing" && !model.sending && !["unknown", "failed"].includes(model.receipt?.state ?? ""), false) }, [editor, model.draft?.state, model.sending, model.receipt?.state])
  async function insertImages(files: File[]) {
    const session = currentSession.current
    for (const file of files) {
      const image = await latest.current.importImage(file)
      if (!image || currentSession.current !== session || !editor || editor.isDestroyed) return
      editor.chain().focus().setImage({ src: `cid:${image.cid}`, alt: file.name }).run()
    }
  }
  const format = (mark: "bold" | "italic" | "underline" | "bulletList" | "orderedList" | "undo" | "redo") => {
    if (!editor) return
    const command = editor.chain().focus()
    if (mark === "bold") command.toggleBold().run()
    else if (mark === "italic") command.toggleItalic().run()
    else if (mark === "underline") command.toggleUnderline().run()
    else if (mark === "bulletList") command.toggleBulletList().run()
    else if (mark === "orderedList") command.toggleOrderedList().run()
    else if (mark === "undo") command.undo().run()
    else if (mark === "redo") command.redo().run()

  }
  const fontSize = (size: string) => { editor?.chain().focus().setFontSize(size).run() }
  const applyLink = () => {
    if (!editor) return
    try {
      if (!link.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run()
      else {
        const url = new URL(link)
        if (!["http:", "https:", "mailto:"].includes(url.protocol) || url.username || url.password) throw new Error("请输入有效的网页或邮箱链接")
        editor.chain().focus().extendMarkRange("link").setLink({ href: url.toString() }).run()
      }
      setLinkOpen(false); setError(null)
    } catch (cause) { setError(mailError(cause)) }
  }
  return { editor, error, activeMarks, format, fontSize, linkOpen, setLinkOpen, link, changeLink, applyLink, insertImages, addresses: model.addresses ?? empty }
}
