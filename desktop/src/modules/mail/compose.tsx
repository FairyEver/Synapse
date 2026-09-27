import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailAttachment, MailContent, MailDraft, MailPerson } from "@/types/mail"

export type ComposeStart = { recipientIds?: string[]; subject?: string; body?: string; replyToId?: string; draft?: MailDraft }

export function MailCompose({ start, onClose, onSent }: { start: ComposeStart | null; onClose: () => void; onSent: () => void }) {
  const [recipientSearch, setRecipientSearch] = useState("")
  const [candidates, setCandidates] = useState<MailPerson[]>([])
  const [recipients, setRecipients] = useState<MailPerson[]>([])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<MailAttachment[]>([])
  const [driveOpen, setDriveOpen] = useState(false)
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null)
  const [driveItems, setDriveItems] = useState<{ id: string; name: string; type: "file" | "folder" }[]>([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<MailDraft | null>(null)
  const pendingSend = useRef<{ fingerprint: string; previewId: string; clientRequestId: string } | null>(null)

  useEffect(() => {
    if (!start) return
    setSubject(start.subject ?? start.draft?.subject ?? "")
    setBody(start.body ?? start.draft?.body ?? "")
    setDraft(start.draft ?? null)
    setAttachments(start.draft?.attachments ?? [])
    setRecipients([])
    setRecipientSearch("")
    pendingSend.current = null
  }, [start])

  useEffect(() => {
    if (!start || !recipientSearch.trim()) { setCandidates([]); return }
    let active = true
    const timeout = window.setTimeout(() => {
      void mailRequest({ kind: "recipientSearch", query: recipientSearch.trim() })
        .then((result) => { if (active) setCandidates(result.items) })
        .catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : "搜索收件人失败。") })
    }, 250)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [recipientSearch, start])

  useEffect(() => {
    if (!start) return
    const ids = start.recipientIds ?? start.draft?.recipientIds ?? []
    if (!ids.length) return
    let active = true
    void Promise.all(ids.map((id) => mailRequest({ kind: "recipientSearch", query: id })))
      .then((pages) => { if (active) setRecipients(pages.flatMap((page) => page.items).filter((person, index, all) => all.findIndex((item) => item.userId === person.userId) === index)) })
      .catch(() => { /* names can be resolved again in the search field */ })
    return () => { active = false }
  }, [start])

  useEffect(() => {
    if (!driveOpen) return
    let active = true
    const bridge = getSynapseBridge()
    if (!bridge) return
    void bridge.drive.item.list({ parentId: driveFolderId })
      .then((page) => { if (active) setDriveItems(page.items.map((item) => ({ id: item.id, name: item.name, type: item.type }))) })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "云盘加载失败。"))
    return () => { active = false }
  }, [driveOpen, driveFolderId])

  const content = (): MailContent => ({ recipientIds: recipients.map((person) => person.userId), subject, body, attachmentIds: attachments.map((item) => item.attachmentId), replyToId: start?.replyToId ?? start?.draft?.replyToId ?? undefined })

  async function saveDraft() {
    setBusy(true)
    try {
      const current = content()
      const saved = draft
        ? await mailRequest({ kind: "draftUpdate", draftId: draft.draftId, baseVersion: draft.version, content: current })
        : await mailRequest({ kind: "draftCreate", content: current })
      setDraft(saved)
      toast.success("草稿已保存")
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "草稿保存失败。")
    } finally { setBusy(false) }
  }

  async function send() {
    setBusy(true)
    try {
      const current = content()
      const fingerprint = JSON.stringify(current)
      if (pendingSend.current?.fingerprint !== fingerprint) {
        const preview = await mailRequest({ kind: "sendPreview", content: current })
        pendingSend.current = { fingerprint, previewId: preview.previewId, clientRequestId: crypto.randomUUID() }
      }
      await mailRequest({ kind: "send", previewId: pendingSend.current.previewId, clientRequestId: pendingSend.current.clientRequestId })
      pendingSend.current = null
      if (draft) {
        try { await mailRequest({ kind: "draftDelete", draftId: draft.draftId }) }
        catch { toast.error("信件已发送，草稿删除失败。") }
      }
      toast.success("已发送")
      onSent()
      onClose()
    } catch (error) {
      if (error instanceof Error && error.message.includes("发送预览已过期")) pendingSend.current = null
      toast.error(error instanceof Error ? error.message : "发送失败。")
    } finally { setBusy(false) }
  }

  async function attachLocal(file: File | undefined) {
    if (!file) return
    const filePath = getSynapseBridge()?.drive.localFile.pathForDroppedFile(file)
    if (!filePath) { toast.error("无法读取所选文件。") ; return }
    setBusy(true)
    try {
      const result = await mailRequest({ kind: "attachmentLocal", filePath })
      setAttachments((current) => [...current, result])
    } catch (error) { toast.error(error instanceof Error ? error.message : "添加附件失败。") }
    finally { setBusy(false) }
  }

  async function attachDrive(itemId: string) {
    setBusy(true)
    try {
      const result = await mailRequest({ kind: "attachmentPrepare", driveItemId: itemId })
      setAttachments((current) => [...current, result])
      setDriveOpen(false)
    } catch (error) { toast.error(error instanceof Error ? error.message : "添加附件失败。") }
    finally { setBusy(false) }
  }

  return <>
    <Dialog open={start !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>写信</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="mail-recipient-search" className="text-sm font-medium">收件人</label>
            <Input id="mail-recipient-search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="搜索姓名或 handle" />
            {!!candidates.length && <div className="max-h-32 overflow-y-auto rounded-md border">
              {candidates.map((person) => <button key={person.userId} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setRecipients((current) => current.some((item) => item.userId === person.userId) ? current : [...current, person]); setRecipientSearch(""); setCandidates([]) }}>
                <span>{person.nickname || person.handle}</span><span className="text-muted-foreground">{person.handle}</span>
              </button>)}
            </div>}
            <div className="flex flex-wrap gap-2">{recipients.map((person) => <Button key={person.userId} type="button" variant="secondary" size="sm" onClick={() => setRecipients((current) => current.filter((item) => item.userId !== person.userId))}>{person.nickname || person.handle} ×</Button>)}</div>
          </div>
          <div className="space-y-2"><label htmlFor="mail-subject" className="text-sm font-medium">主题</label><Input id="mail-subject" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
          <div className="space-y-2"><label htmlFor="mail-body" className="text-sm font-medium">正文</label><Textarea id="mail-body" rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></div>
          <div className="space-y-2"><p className="text-sm font-medium">附件</p><div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">选本机文件<input type="file" className="sr-only" onChange={(event) => void attachLocal(event.target.files?.[0])} /></label><Button type="button" variant="outline" onClick={() => setDriveOpen(true)}>从云盘选择</Button></div>
            {attachments.map((attachment) => <Button key={attachment.attachmentId} type="button" size="sm" variant="secondary" onClick={() => setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}>{attachment.fileName} ×</Button>)}
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => void saveDraft()}>保存草稿</Button><Button type="button" disabled={busy || !recipients.length || !subject.trim() || !body.trim()} onClick={() => void send()}>发送</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={driveOpen} onOpenChange={setDriveOpen}>
      <DialogContent><DialogHeader><DialogTitle>选择云盘文件</DialogTitle></DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {driveFolderId && <Button type="button" variant="ghost" onClick={() => setDriveFolderId(null)}>返回根目录</Button>}
          {driveItems.map((item) => <button key={item.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => item.type === "folder" ? setDriveFolderId(item.id) : void attachDrive(item.id)}>{item.name}</button>)}
        </div>
      </DialogContent>
    </Dialog>
  </>
}
