import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Paperclip, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailAttachment, MailContent, MailPerson } from "@/types/mail"
import { useRecipients } from "./use-recipients"

export type ComposeStart = { recipientIds?: string[]; subject?: string; body?: string; replyToId?: string }

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }

export function MailCompose({ start, onClose, onSent }: { start: ComposeStart | null; onClose: () => void; onSent: () => void }) {
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
  const [recipientSearch, setRecipientSearch] = useState("")
  const candidates = useRecipients(start !== null && recipientPickerOpen, recipientSearch)
  const [recipients, setRecipients] = useState<MailPerson[]>([])
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<MailAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingSend = useRef<{ fingerprint: string; previewId: string; clientRequestId: string } | null>(null)

  useEffect(() => {
    if (!start) { setRecipientPickerOpen(false); return }
    setSubject(start.subject ?? "")
    setBody(start.body ?? "")
    setAttachments([])
    setRecipients([])
    setUnresolvedIds([])
    setRecipientPickerOpen(false)
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
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>写信</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mail-recipient-picker">收件人</Label>
          <Popover open={recipientPickerOpen} onOpenChange={(open) => { setRecipientPickerOpen(open); if (!open) setRecipientSearch("") }}>
            <PopoverTrigger asChild>
              <Button id="mail-recipient-picker" type="button" variant="outline" role="combobox" aria-expanded={recipientPickerOpen} className="w-full justify-between font-normal">
                <span className="text-muted-foreground">{recipients.length ? "添加收件人" : "选择收件人"}</span>
                <ChevronsUpDown className="text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-1.5">
              <Command shouldFilter={false}>
                <CommandInput aria-label="搜索收件人" maxLength={100} value={recipientSearch} onValueChange={setRecipientSearch} placeholder="搜索姓名或账号" />
                <CommandList aria-label="可选收件人" className="max-h-56">
                  <CommandGroup>
                    {candidates.items.map((person) => <CommandItem key={person.userId} value={person.userId} data-checked={recipients.some((item) => item.userId === person.userId)} className="min-h-10" onSelect={() => toggleRecipient(person)}>
                      <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
                      {person.handle && person.handle !== personName(person) && <span className="truncate text-xs text-muted-foreground">{person.handle}</span>}
                    </CommandItem>)}
                  </CommandGroup>
                  {candidates.loading && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">加载成员中…</p>}
                  {!candidates.loading && !candidates.error && !candidates.items.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{recipientSearch.trim() ? "没有匹配的成员" : "没有可选成员"}</p>}
                  {candidates.error && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="text-destructive">{candidates.error}</span><Button type="button" variant="ghost" onClick={candidates.retry}>重试</Button></div>}
                  {candidates.nextCursor && <div className="p-1 text-center"><Button type="button" variant="ghost" disabled={candidates.loadingMore} onClick={candidates.loadMore}>{candidates.loadingMore ? "加载中…" : "加载更多"}</Button></div>}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {!!recipients.length && <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label="已选收件人">{recipients.map((person) => <Button key={person.userId} type="button" variant="secondary" size="sm" className="max-w-full" aria-label={`移除 ${personName(person)}`} onClick={() => toggleRecipient(person)}><span className="truncate">{personName(person)}</span><X /></Button>)}</div>}
          {!!unresolvedIds.length && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">收件人无法确认，请移除或重新搜索{unresolvedIds.map((id) => <Button key={id} type="button" variant="outline" size="sm" onClick={() => setUnresolvedIds((current) => current.filter((item) => item !== id))}>{id}<X /></Button>)}</div>}
        </div>
        <div className="space-y-2"><Label htmlFor="mail-subject">主题</Label><Input id="mail-subject" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="mail-body">正文</Label><Textarea id="mail-body" rows={6} value={body} onChange={(event) => setBody(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="mail-attachment">附件</Label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip />添加附件</Button><input ref={fileInput} id="mail-attachment" type="file" className="sr-only" tabIndex={-1} onChange={(event) => { void attachLocal(event.target.files?.[0]); event.currentTarget.value = "" }} />
          {attachments.map((attachment) => <Button key={attachment.attachmentId} type="button" variant="secondary" size="sm" className="max-w-full" aria-label={`移除附件 ${attachment.fileName}`} onClick={() => setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}><span className="truncate">{attachment.fileName}</span><X /></Button>)}</div>
        </div>
      </div>
      <DialogFooter><Button type="button" disabled={busy || !recipients.length || !!unresolvedIds.length || !subject.trim() || !body.trim()} onClick={() => void send()}>发送</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
