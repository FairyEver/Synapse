import { useCallback, useEffect, useRef, useState } from "react"
import type { Draft, DraftInput, MailPreview, SendReceipt, MailAsset } from "../../../app-capabilities/mail/shared/types"
import { addressSchema } from "../../../app-capabilities/mail/shared/schema"
import { MAIL_MAX_IMAGE_BYTES } from "../../../app-capabilities/mail/shared/limits"
import { sanitizeComposeDocument } from "../../../app-capabilities/mail/renderer/compose-document"
import { runMailUiOperation } from "../../../app-capabilities/mail/renderer/tracking"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailApi, mailError } from "./api"
import { registerNavigationGuard } from "@/app-shell/navigation-guard"
import type { ComposeIntent } from "./layout"
const fields = (draft: Draft): Omit<DraftInput, "accountId"> => ({ to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, html: draft.html, text: draft.text, assetIds: draft.assetIds, inlineImages: draft.inlineImages })
const addressText = (addresses: Draft["to"]) => addresses.map(a => a.name ? `${JSON.stringify(a.name)} <${a.address}>` : a.address).join(", ")
export function parseMailAddresses(value: string): Draft["to"] {
  const parts: string[] = []
  let part = "", quoted = false, escaped = false, angle = false
  for (const char of value) {
    if (escaped) { part += char; escaped = false; continue }
    if (quoted && char === "\\") { part += char; escaped = true; continue }
    if (char === '"') quoted = !quoted
    if (!quoted && char === "<") { if (angle) throw new Error("收件人格式无效"); angle = true }
    if (!quoted && char === ">") { if (!angle) throw new Error("收件人格式无效"); angle = false }
    if (!quoted && !angle && /[,;\n]/u.test(char)) { parts.push(part); part = "" } else part += char
  }
  if (quoted || angle || escaped) throw new Error("收件人格式无效")
  parts.push(part)
  return parts.map(item => item.trim()).filter(Boolean).map(item => {
    const formatted = item.match(/^(.*?)<([^<>]+)>$/u)
    if (!formatted) return addressSchema.parse({ address: item })
    const rawName = formatted[1].trim()
    const name = rawName.startsWith('"') && rawName.endsWith('"') ? rawName.slice(1, -1).replace(/\\(.)/gu, "$1") : rawName
    return addressSchema.parse({ address: formatted[2].trim(), name })
  })
}
export function useCompose(owner: string | null, onClosed?: () => void) {
  const closedCallback = useRef(onClosed); closedCallback.current = onClosed
  const persisted = useRef(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null), [addresses, setAddresses] = useState({ to: "", cc: "", bcc: "" })
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false), [sending, setSending] = useState(false), [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false), [editVersion, setEditVersion] = useState(0), [preview, setPreview] = useState<MailPreview | null>(null), [receipt, setReceipt] = useState<SendReceipt | null>(null)
  const value = useRef<Draft | null>(null), addressRef = useRef(addresses), changed = useRef(0), saved = useRef(0), epoch = useRef(0), active = useRef(true), ownerRef = useRef(owner)
  ownerRef.current = owner
  const savingTask = useRef<Promise<void> | null>(null), sendLock = useRef(false), opening = useRef(false)
  const request = useRef<{ previewId: string; key: string } | null>(null)
  const replace = (next: Draft | null) => { value.current = next; setDraft(next) }
  const initialize = (next: Draft) => {
    replace(next); const a = { to: addressText(next.to), cc: addressText(next.cc), bcc: addressText(next.bcc) }; addressRef.current = a; setAddresses(a); changed.current = 0; saved.current = 0; setDirty(false); setPreview(null); setReceipt(null); request.current = null
  }
  useEffect(() => {
    active.current = true; epoch.current++; replace(null); setDirty(false); setError(null); setPreview(null); setReceipt(null); sendLock.current = false; opening.current = false; savingTask.current = null; setSaving(false); setSending(false); setLoading(false); setCloseRequested(false); persisted.current = false; changed.current = 0; saved.current = 0
    return () => { active.current = false; epoch.current++ }
  }, [owner])
  const open = useCallback(async (intent: ComposeIntent) => {
    if (!owner || opening.current || sendLock.current) return
    if (value.current) throw new Error("请先关闭当前写信窗口")
    opening.current = true; const e = ++epoch.current; setError(null); setLoading(true)
    try {
      const next = "draftId" in intent ? await mailApi().draftGet({ draftId: intent.draftId }) : await mailApi().draftPrepare("sourceMessageId" in intent ? { accountId: intent.accountId, sourceMessageId: intent.sourceMessageId, mode: intent.mode!, forwardMode: "inline" } : { accountId: intent.accountId })
      if (active.current && epoch.current === e && ownerRef.current === owner) { persisted.current = "draftId" in intent; initialize(next) }
    } catch (cause) { if (epoch.current === e) { setError(mailError(cause)); throw cause } }
    finally { if (epoch.current === e) { opening.current = false; setLoading(false) } }
  }, [owner])
  const edit = useCallback((patch: Partial<Omit<DraftInput, "accountId">>) => {
    if (!value.current || value.current.state !== "editing" || sendLock.current) return
    changed.current++; replace({ ...value.current, ...patch }); setDirty(true); setPreview(null); request.current = null; setEditVersion(changed.current)
  }, [])
  const changeAddress = (key: keyof typeof addresses, text: string) => {
    if (sendLock.current || value.current?.state !== "editing") return
    addressRef.current = { ...addressRef.current, [key]: text }; setAddresses(addressRef.current); changed.current++; setDirty(true); setPreview(null); request.current = null; setEditVersion(changed.current)
  }
  const save = useCallback(async (): Promise<void> => {
    if (savingTask.current) return savingTask.current
    const snapshot = value.current
    if (!snapshot || (persisted.current && changed.current === saved.current) || snapshot.state !== "editing") return
    const version = changed.current, e = epoch.current, identity = ownerRef.current, recipientSnapshot = { ...addressRef.current }, wasPersisted = persisted.current
    setSaving(true); setError(null)
    const task = Promise.resolve().then(async () => {
      try {
        const body = sanitizeComposeDocument(snapshot.html, snapshot.inlineImages)
        const patch = { ...fields(snapshot), ...body, to: parseMailAddresses(recipientSnapshot.to), cc: parseMailAddresses(recipientSnapshot.cc), bcc: parseMailAddresses(recipientSnapshot.bcc) }
        const result = await runMailUiOperation("save", () => wasPersisted ? mailApi().draftUpdate({ draftId: snapshot.id, expectedRevision: snapshot.revision, patch }) : mailApi().draftCommit({ content: { accountId: snapshot.accountId, ...patch }, ...(snapshot.sourceMessageId && snapshot.mode !== "new" ? { source: { messageId: snapshot.sourceMessageId, mode: snapshot.mode } } : {}) }))
        if (!active.current || e !== epoch.current || identity !== ownerRef.current) return
        persisted.current = true; saved.current = version
        replace(changed.current === version ? result : { ...value.current!, id: result.id, revision: result.revision, localSaved: result.localSaved, syncState: result.syncState })
        setDirty(changed.current !== saved.current)
      } catch (cause) { if (active.current && e === epoch.current) setError(mailError(cause)); throw cause }
      finally { if (e === epoch.current) { setSaving(false); savingTask.current = null } }
    })
    savingTask.current = task; return task
  }, [])
  const flush = useCallback(async () => { await save(); while (value.current?.state === "editing" && changed.current !== saved.current) await save() }, [save])
  const finishClose = useCallback(() => {
    epoch.current++; opening.current = false; replace(null); setLoading(false); setPreview(null); setReceipt(null); setDirty(false); setError(null); setCloseRequested(false)
    changed.current = 0; saved.current = 0; persisted.current = false
    closedCallback.current?.()
    return true
  }, [])
  const close = useCallback(async () => {
    if (sendLock.current || savingTask.current) return false
    if (changed.current !== saved.current) { setCloseRequested(true); return false }
    return finishClose()
  }, [finishClose])
  const resolveClose = async (choice: "save" | "discard" | "cancel") => {
    if (choice === "cancel") { setCloseRequested(false); return false }
    if (sendLock.current || savingTask.current) return false
    if (choice === "discard") return finishClose()
    try { await flush(); return finishClose() } catch { return false }
  }
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (changed.current !== saved.current || sendLock.current || savingTask.current) {
        event.preventDefault(); event.returnValue = ""
        if (!sendLock.current && !savingTask.current) setCloseRequested(true)
      }
    }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [])
  useEffect(() => registerNavigationGuard(() => !sendLock.current && !savingTask.current && changed.current === saved.current), [owner])
  const preparePreview = async () => {
    const e = epoch.current
    try {
      await flush(); const current = value.current
      if (!current || current.state !== "editing") throw new Error("草稿不能发送，请另存为新草稿")
      const result = await mailApi().sendPreview({ draftId: current.id, expectedRevision: current.revision })
      if (epoch.current !== e || !active.current) throw new Error("邮箱身份已变化")
      setPreview(result); return result
    } catch (cause) { if (e === epoch.current) setError(mailError(cause)); throw cause }
  }
  const send = async () => {
    if (sendLock.current || value.current?.state !== "editing" || receipt?.state === "unknown" || receipt?.state === "failed") return
    sendLock.current = true; setSending(true); setError(null); const e = epoch.current
    try {
      const frozen = preview && Date.parse(preview.expiresAt) > Date.now() && !dirty ? preview : await preparePreview()
      if (!request.current || request.current.previewId !== frozen.previewId) request.current = { previewId: frozen.previewId, key: crypto.randomUUID() }
      const response = await runMailUiOperation("send", () => mailApi().messageSend({ previewId: frozen.previewId, clientRequestId: request.current!.key, confirmed: true }))
      if (epoch.current !== e || !active.current) return
      setReceipt(response)
      if (response.state === "accepted" || response.state === "partial") replace({ ...value.current!, state: "consumed" })
    } catch (cause) { if (epoch.current === e) setError(mailError(cause)) }
    finally { if (epoch.current === e) { sendLock.current = false; setSending(false) } }
  }
  const reconcile = async () => { if (!receipt) return; const e = epoch.current; try { const result = await mailApi().operationGet({ operationId: receipt.operationId }); if (e === epoch.current) setReceipt(result) } catch (cause) { if (e === epoch.current) setError(mailError(cause)) } }
  const copyDraft = async () => {
    if (!value.current || sendLock.current) return
    const e = epoch.current
    try { const source = value.current, result = await mailApi().draftCreate({ accountId: source.accountId, ...fields(source), to: parseMailAddresses(addressRef.current.to), cc: parseMailAddresses(addressRef.current.cc), bcc: parseMailAddresses(addressRef.current.bcc) }); if (active.current && e === epoch.current) { epoch.current++; persisted.current = true; initialize(result) } }
    catch (cause) { if (e === epoch.current) setError(mailError(cause)) }
  }
  const attach = (assets: MailAsset[]) => { const current = value.current; if (current) edit({ assetIds: [...new Set([...current.assetIds, ...assets.map(a => a.id)])] }) }
  const pickAttachments = async () => { const current = value.current, session = epoch.current; if (!current) return; try { const assets = await mailApi().pickAttachments({ accountId: current.accountId }); if (active.current && epoch.current === session) attach(assets) } catch (cause) { setError(mailError(cause)) } }
  const importFiles = async (files: File[]) => {
    const current = value.current, session = epoch.current; if (!current) return
    try {
      const assets: MailAsset[] = []
      for (const file of files) {
        const filePath = getSynapseBridge()?.shell.filePathForDroppedFile(file)
        if (!filePath) throw new Error("无法读取此文件，请使用选择附件")
        assets.push(await mailApi().attachmentImportLocal({ accountId: current.accountId, filePath }))
      }
      if (active.current && epoch.current === session) attach(assets)
    } catch (cause) { setError(mailError(cause)) }
  }
  const importImage = async (file: File): Promise<{ assetId: string; cid: string } | null> => {
    const current = value.current, session = epoch.current; if (!current) return null
    try {
      if (file.size > MAIL_MAX_IMAGE_BYTES) throw new Error("图片不能超过 10 MiB")
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
      const asset = await mailApi().imageImport({ accountId: current.accountId, base64: btoa(binary) })
      if (!active.current || epoch.current !== session || !value.current) return null
      const image = { assetId: asset.id, cid: `${crypto.randomUUID()}@synapse.local` }
      edit({ inlineImages: [...value.current.inlineImages, image] }); return image
    } catch (cause) { setError(mailError(cause)); return null }
  }
  return { sessionId: epoch.current, closeRequested, resolveClose, draft, currentDraft: () => value.current, addresses, error, saving, sending, loading, dirty, preview, receipt, editVersion, open, edit, changeAddress, save, close, preparePreview, send, reconcile, copyDraft, pickAttachments, importFiles, importImage }
}
export type ComposeModel = ReturnType<typeof useCompose>
