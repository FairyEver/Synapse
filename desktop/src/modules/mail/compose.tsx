import { useEffect, useRef, useState } from "react"
import { Check, Paperclip, Search, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogFrame, DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailAttachment, MailContent, MailPerson } from "@/types/mail"
import { useRecipients } from "./use-recipients"

export type ComposeStart = { recipientIds?: string[]; subject?: string; body?: string; replyToId?: string }

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }

export function MailCompose({ start, onClose, onSent }: { start: ComposeStart | null; onClose: () => void; onSent: () => void }) {
  const [recipientSearch, setRecipientSearch] = useState("")
  const candidates = useRecipients(start !== null, recipientSearch)
  const [recipients, setRecipients] = useState<MailPerson[]>([])
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<MailAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const recipientInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingSend = useRef<{ fingerprint: string; previewId: string; clientRequestId: string } | null>(null)

  useEffect(() => {
    if (!start) return
    setSubject(start.subject ?? "")
    setBody(start.body ?? "")
    setAttachments([])
    setRecipients([])
    setUnresolvedIds([])
    setRecipientSearch("")
    pendingSend.current = null
  }, [start])

  useEffect(() => {
    if (!start) return
    const ids = start.recipientIds ?? []
    if (!ids.length) return
    let active = true
    void Promise.allSettled(ids.map((id) => mailRequest({ kind: "recipientSearch", query: id })))
      .then((pages) => {
        if (!active) return
        const resolved = pages.flatMap((page, index) => page.status === "fulfilled" ? page.value.items.filter((person) => person.userId === ids[index]) : [])
        setRecipients((current) => [...current, ...resolved.filter((person) => !current.some((item) => item.userId === person.userId))])
        setUnresolvedIds(ids.filter((id) => !resolved.some((person) => person.userId === id)))
      })
    return () => { active = false }
  }, [start])

  useEffect(() => {
    setUnresolvedIds((current) => {
      const unresolved = current.filter((id) => !recipients.some((person) => person.userId === id))
      return unresolved.length === current.length ? current : unresolved
    })
  }, [recipients])

  function toggleRecipient(person: MailPerson) {
    if (recipients.some((item) => item.userId === person.userId)) {
      setRecipients((current) => current.filter((item) => item.userId !== person.userId))
      return
    }
    if (recipients.length + unresolvedIds.filter((id) => id !== person.userId).length >= 50) {
      toast.error("最多选择 50 位收件人。")
      return
    }
    setRecipients((current) => [...current, person])
    setUnresolvedIds((current) => current.filter((id) => id !== person.userId))
  }

  const content = (): MailContent => ({ recipientIds: [...recipients.map((person) => person.userId), ...unresolvedIds], subject, body, attachmentIds: attachments.map((item) => item.attachmentId), replyToId: start?.replyToId })

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
    if (!filePath) { toast.error("无法读取所选文件。"); return }
    setBusy(true)
    try {
      const result = await mailRequest({ kind: "attachmentLocal", filePath })
      setAttachments((current) => [...current, result])
    } catch (error) { toast.error(error instanceof Error ? error.message : "添加附件失败。") }
    finally { setBusy(false) }
  }

  return <Dialog open={start !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); recipientInput.current?.focus() }} className="h-[48rem] max-h-[90vh] gap-0 p-0 sm:max-w-2xl">
      <DialogFrame>
        <DialogFrameHeader title="写信" bordered showCloseButton={false} actions={<DialogClose asChild><Button type="button" variant="ghost" size="icon" className="size-10" disabled={busy} aria-label="关闭"><X /></Button></DialogClose>} />
        <DialogFrameBody className="space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="mail-recipient-search">收件人</Label>
              <span className="text-xs tabular-nums text-muted-foreground">已选 {recipients.length}/50</span>
            </div>
            <InputGroup className="h-10">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput ref={recipientInput} id="mail-recipient-search" type="search" maxLength={100} value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="搜索姓名或账号" />
            </InputGroup>
            <div role="group" aria-label="可选收件人" className="max-h-48 min-h-24 overflow-y-auto rounded-lg border">
              {candidates.items.map((person) => {
                const selected = recipients.some((item) => item.userId === person.userId)
                return <Button key={person.userId} type="button" variant="ghost" aria-pressed={selected} className={`h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-left whitespace-normal ${selected ? "bg-muted" : ""}`} onClick={() => toggleRecipient(person)}>
                  <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
                  {person.handle && person.handle !== personName(person) && <span className="min-w-0 truncate text-xs text-muted-foreground">{person.handle}</span>}
                  <Check className={`ml-auto size-4 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
                </Button>
              })}
              {candidates.loading && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">加载成员中…</p>}
              {!candidates.loading && !candidates.error && !candidates.items.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{recipientSearch.trim() ? "没有匹配的成员" : "没有可选成员"}</p>}
              {candidates.error && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="text-destructive">{candidates.error}</span><Button type="button" variant="ghost" className="min-h-10" onClick={candidates.retry}>重试</Button></div>}
              {candidates.nextCursor && <div className="p-1 text-center"><Button type="button" variant="ghost" className="min-h-10" disabled={candidates.loadingMore} onClick={candidates.loadMore}>{candidates.loadingMore ? "加载中…" : "加载更多"}</Button></div>}
            </div>
            {!!recipients.length && <div className="flex flex-wrap gap-2" aria-label="已选收件人">{recipients.map((person) => <Button key={person.userId} type="button" variant="secondary" className="max-w-full min-h-10" aria-label={`移除 ${personName(person)}`} onClick={() => toggleRecipient(person)}><span className="truncate">{personName(person)}</span><X /></Button>)}</div>}
            {!!unresolvedIds.length && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">收件人无法确认，请移除或重新搜索{unresolvedIds.map((id) => <Button key={id} type="button" variant="outline" className="min-h-10" onClick={() => setUnresolvedIds((current) => current.filter((item) => item !== id))}>{id}<X /></Button>)}</div>}
          </section>
          <div className="space-y-2"><Label htmlFor="mail-subject">主题</Label><Input id="mail-subject" className="h-10" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="mail-body">正文</Label><Textarea id="mail-body" className="min-h-40 resize-y" rows={6} value={body} onChange={(event) => setBody(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="mail-attachment">附件</Label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-10" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip />添加附件</Button><input ref={fileInput} id="mail-attachment" type="file" className="sr-only" tabIndex={-1} onChange={(event) => { void attachLocal(event.target.files?.[0]); event.currentTarget.value = "" }} />
            {attachments.map((attachment) => <Button key={attachment.attachmentId} type="button" variant="secondary" className="max-w-full min-h-10" aria-label={`移除附件 ${attachment.fileName}`} onClick={() => setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}><span className="truncate">{attachment.fileName}</span><X /></Button>)}</div>
          </div>
        </DialogFrameBody>
        <DialogFrameFooter><Button type="button" className="min-h-10" disabled={busy || !recipients.length || !!unresolvedIds.length || !subject.trim() || !body.trim()} onClick={() => void send()}><Send />发送</Button></DialogFrameFooter>
      </DialogFrame>
    </DialogContent>
  </Dialog>
}
