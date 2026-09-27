import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailAttachment, MailContent, MailDraft, MailPerson } from "@/types/mail"

export type ComposeStart = { recipientIds?: string[]; subject?: string; body?: string; replyToId?: string; draft?: MailDraft }

export function MailCompose({ start, onClose, onChanged, onSent }: { start: ComposeStart | null; onClose: () => void; onChanged: () => void; onSent: () => void }) {
  const [recipientSearch, setRecipientSearch] = useState("")
  const [candidates, setCandidates] = useState<MailPerson[]>([])
  const [recipients, setRecipients] = useState<MailPerson[]>([])
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([])
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<MailAttachment[]>([])
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
    setUnresolvedIds([])
    setCloseConfirm(false)
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
    void Promise.allSettled(ids.map((id) => mailRequest({ kind: "recipientSearch", query: id })))
      .then((pages) => {
        if (!active) return
        const resolved = pages.flatMap((page, index) => page.status === "fulfilled" ? page.value.items.filter((person) => person.userId === ids[index]) : [])
        setRecipients(resolved)
        setUnresolvedIds(ids.filter((id) => !resolved.some((person) => person.userId === id)))
      })
    return () => { active = false }
  }, [start])

  const content = (): MailContent => ({ recipientIds: [...recipients.map((person) => person.userId), ...unresolvedIds], subject, body, attachmentIds: attachments.map((item) => item.attachmentId), replyToId: start?.replyToId ?? start?.draft?.replyToId ?? undefined })

  function requestClose() {
    if (busy) return
    if (recipients.length || unresolvedIds.length || subject.trim() || body.trim() || attachments.length) setCloseConfirm(true)
    else onClose()
  }

  async function saveDraft() {
    setBusy(true)
    try {
      const current = content()
      const saved = draft
        ? await mailRequest({ kind: "draftUpdate", draftId: draft.draftId, baseVersion: draft.version, content: current })
        : await mailRequest({ kind: "draftCreate", content: current })
      setDraft(saved)
      toast.success("草稿已保存")
      onChanged()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "草稿保存失败。")
    } finally { setBusy(false) }
  }

  async function send() {
    if (unresolvedIds.length) { toast.error("请确认未识别的收件人。"); return }
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

  return <>
    <Dialog open={start !== null} onOpenChange={(open) => { if (!open) requestClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>写信</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="mail-recipient-search" className="text-sm font-medium">收件人</label>
            <Input id="mail-recipient-search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="搜索姓名或 handle" />
            {!!candidates.length && <div className="max-h-32 overflow-y-auto rounded-md border">
              {candidates.map((person) => <button key={person.userId} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setRecipients((current) => current.some((item) => item.userId === person.userId) ? current : [...current, person]); setUnresolvedIds((current) => current.filter((id) => id !== person.userId)); setRecipientSearch(""); setCandidates([]) }}>
                <span>{person.nickname || person.handle}</span><span className="text-muted-foreground">{person.handle}</span>
              </button>)}
            </div>}
            <div className="flex flex-wrap gap-2">{recipients.map((person) => <Button key={person.userId} type="button" variant="secondary" size="sm" onClick={() => setRecipients((current) => current.filter((item) => item.userId !== person.userId))}>{person.nickname || person.handle} ×</Button>)}</div>
            {!!unresolvedIds.length && <div role="alert" className="text-sm text-destructive">收件人无法确认，请移除或重新搜索：{unresolvedIds.map((id) => <Button key={id} type="button" variant="ghost" size="sm" onClick={() => setUnresolvedIds((current) => current.filter((item) => item !== id))}>{id} ×</Button>)}</div>}
          </div>
          <div className="space-y-2"><label htmlFor="mail-subject" className="text-sm font-medium">主题</label><Input id="mail-subject" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
          <div className="space-y-2"><label htmlFor="mail-body" className="text-sm font-medium">正文</label><Textarea id="mail-body" rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></div>
          <div className="space-y-2"><p className="text-sm font-medium">附件</p><label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">选本机文件<input type="file" className="sr-only" onChange={(event) => void attachLocal(event.target.files?.[0])} /></label>
            {attachments.map((attachment) => <Button key={attachment.attachmentId} type="button" size="sm" variant="secondary" onClick={() => setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}>{attachment.fileName} ×</Button>)}
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => void saveDraft()}>保存草稿</Button><Button type="button" disabled={busy || !recipients.length || !!unresolvedIds.length || !subject.trim() || !body.trim()} onClick={() => void send()}>发送</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>保存这封草稿？</AlertDialogTitle></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>继续编辑</AlertDialogCancel>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setCloseConfirm(false); void saveDraft() }}>保存草稿</Button>
          <AlertDialogAction onClick={onClose}>不保存</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
