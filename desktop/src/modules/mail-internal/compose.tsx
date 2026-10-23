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
import type { MailAttachment, MailContent, MailMessage, MailOrganization, MailOperationResult, MailPerson, MailRelation } from "@/types/mail"
import { useRecipients } from "./use-recipients"
import { useOrganizations } from "./use-organizations"

export type ComposeStart = { toIds?: string[]; ccIds?: string[]; subject?: string; body?: string; relation?: MailRelation; source?: MailMessage }

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }

export function MailCompose({ start, onClose, onSent }: { start: ComposeStart | null; onClose: () => void; onSent: () => void }) {
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
  const [recipientPickerRole, setRecipientPickerRole] = useState<"to" | "cc">("to")
  const [recipientSearch, setRecipientSearch] = useState("")
  const candidates = useRecipients(start !== null && recipientPickerOpen, recipientSearch)
  const organizations = useOrganizations(start !== null && recipientPickerOpen, recipientSearch)
  const [recipients, setRecipients] = useState<MailPerson[]>([])
  const [ccRecipients, setCcRecipients] = useState<MailPerson[]>([])
  const [toOrganizations, setToOrganizations] = useState<MailOrganization[]>([])
  const [ccOrganizations, setCcOrganizations] = useState<MailOrganization[]>([])
  const [expandedOrganizationId, setExpandedOrganizationId] = useState<string | null>(null)
  const [organizationMembers, setOrganizationMembers] = useState<MailPerson[]>([])
  const [organizationMemberCursor, setOrganizationMemberCursor] = useState<string | null>(null)
  const [organizationMemberLoading, setOrganizationMemberLoading] = useState(false)
  const [confirmation, setConfirmation] = useState<MailOperationResult["sendPreview"] | null>(null)
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([])
  const [unresolvedCcIds, setUnresolvedCcIds] = useState<string[]>([])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<MailAttachment[]>([])
  const [forwardAttachmentIds, setForwardAttachmentIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const dialogContent = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingSend = useRef<{ fingerprint: string; previewId: string; clientRequestId: string } | null>(null)

  useEffect(() => {
    if (!start) { setRecipientPickerOpen(false); return }
    setSubject(start.subject ?? "")
    setBody(start.body ?? "")
    setAttachments([])
    setForwardAttachmentIds(start.relation?.kind === "forward" ? start.source?.attachments.map((item) => item.attachmentId) ?? [] : [])
    setRecipients([])
    setCcRecipients([])
    setToOrganizations([])
    setCcOrganizations([])
    setConfirmation(null)
    setUnresolvedIds([])
    setUnresolvedCcIds([])
    setRecipientPickerOpen(false)
    setRecipientSearch("")
    pendingSend.current = null
  }, [start])

  useEffect(() => {
    if (!start) return
    const ids = [...(start.toIds ?? []), ...(start.ccIds ?? [])]
    if (!ids.length) return
    let active = true
    void Promise.allSettled(ids.map((id) => mailRequest({ kind: "recipientSearch", query: id })))
      .then((pages) => {
        if (!active) return
        const resolved = pages.flatMap((page, index) => page.status === "fulfilled" ? page.value.items.filter((person) => person.userId === ids[index]) : [])
        const toIds = start.toIds ?? []
        setRecipients(resolved.filter((person) => toIds.includes(person.userId)))
        setCcRecipients(resolved.filter((person) => (start.ccIds ?? []).includes(person.userId)))
        setUnresolvedIds(toIds.filter((id) => !resolved.some((person) => person.userId === id)))
        setUnresolvedCcIds((start.ccIds ?? []).filter((id) => !resolved.some((person) => person.userId === id)))
      })
    return () => { active = false }
  }, [start])

  useEffect(() => {
    setUnresolvedIds((current) => {
      const unresolved = current.filter((id) => !recipients.some((person) => person.userId === id))
      return unresolved.length === current.length ? current : unresolved
    })
  }, [recipients])

  function toggleRecipient(person: MailPerson, role: "to" | "cc") {
    const selected = role === "to" ? recipients : ccRecipients
    const setSelected = role === "to" ? setRecipients : setCcRecipients
    const setUnresolved = role === "to" ? setUnresolvedIds : setUnresolvedCcIds
    if (selected.some((item) => item.userId === person.userId)) {
      setSelected((current) => current.filter((item) => item.userId !== person.userId))
      return
    }
    setRecipients((current) => current.filter((item) => item.userId !== person.userId))
    setCcRecipients((current) => current.filter((item) => item.userId !== person.userId))
    setSelected((current) => [...current, person])
    setUnresolved((current) => current.filter((id) => id !== person.userId))
    if (role === "to") setUnresolvedCcIds((current) => current.filter((id) => id !== person.userId))
    else setUnresolvedIds((current) => current.filter((id) => id !== person.userId))
  }

  function toggleOrganization(organization: MailOrganization, role: "to" | "cc") {
    const selected = role === "to" ? toOrganizations : ccOrganizations
    if (selected.some((item) => item.organizationId === organization.organizationId)) {
      if (role === "to") setToOrganizations((current) => current.filter((item) => item.organizationId !== organization.organizationId))
      else setCcOrganizations((current) => current.filter((item) => item.organizationId !== organization.organizationId))
      return
    }
    if ([...toOrganizations, ...ccOrganizations].some((item) => item.teamId !== organization.teamId)) { toast.error("一封信只能选择同一团队的组织。"); return }
    setToOrganizations((current) => current.filter((item) => item.organizationId !== organization.organizationId))
    setCcOrganizations((current) => current.filter((item) => item.organizationId !== organization.organizationId))
    if (role === "to") setToOrganizations((current) => [...current, organization])
    else setCcOrganizations((current) => [...current, organization])
  }

  async function showOrganizationMembers(organizationId: string, cursor?: string) {
    setOrganizationMemberLoading(true)
    if (!cursor) { setExpandedOrganizationId(organizationId); setOrganizationMembers([]) }
    try {
      const page = await mailRequest({ kind: "organizationMembers", organizationId, cursor })
      setOrganizationMembers((current) => cursor ? [...current, ...page.items] : page.items)
      setOrganizationMemberCursor(page.nextCursor)
    } catch (error) { toast.error(error instanceof Error ? error.message : "加载组织成员失败。") }
    finally { setOrganizationMemberLoading(false) }
  }

  const content = (): MailContent => ({ formatVersion: 3, toIds: [...recipients.map((person) => person.userId), ...unresolvedIds], ccIds: [...ccRecipients.map((person) => person.userId), ...unresolvedCcIds], toOrganizationIds: toOrganizations.map((item) => item.organizationId), ccOrganizationIds: ccOrganizations.map((item) => item.organizationId), subject, body, attachmentIds: attachments.map((item) => item.attachmentId), forwardAttachmentIds, relation: start?.relation })

  async function send() {
    if (unresolvedIds.length || unresolvedCcIds.length) { toast.error("请确认未识别的收件人。"); return }
    setBusy(true)
    try {
      const current = content()
      const fingerprint = JSON.stringify(current)
      if (pendingSend.current?.fingerprint !== fingerprint) {
        const preview = await mailRequest({ kind: "sendPreview", content: current })
        pendingSend.current = { fingerprint, previewId: preview.previewId, clientRequestId: crypto.randomUUID() }
        setConfirmation(preview)
        return
      }
      await mailRequest({ kind: "send", previewId: pendingSend.current.previewId, clientRequestId: pendingSend.current.clientRequestId })
      pendingSend.current = null
      setConfirmation(null)
      toast.success("已发送")
      onSent()
      onClose()
    } catch (error) {
      if (error instanceof Error && error.message.includes("发送预览已过期")) { pendingSend.current = null; setConfirmation(null) }
      toast.error(error instanceof Error ? error.message : "发送失败。")
    } finally { setBusy(false) }
  }

  async function attachLocal(file: File | undefined) {
    if (!file) return
    if (attachments.length + forwardAttachmentIds.length >= 10) { toast.error("附件不能超过 10 个。"); return }
    const filePath = getSynapseBridge()?.drive.localFile.pathForDroppedFile(file)
    if (!filePath) { toast.error("无法读取所选文件。"); return }
    setBusy(true)
    try {
      const result = await mailRequest({ kind: "attachmentLocal", filePath })
      setAttachments((current) => [...current, result])
    } catch (error) { toast.error(error instanceof Error ? error.message : "添加附件失败。") }
    finally { setBusy(false) }
  }

  function recipientField(role: "to" | "cc") {
    const selected = role === "to" ? recipients : ccRecipients
    const selectedOrganizations = role === "to" ? toOrganizations : ccOrganizations
    const unresolved = role === "to" ? unresolvedIds : unresolvedCcIds
    const setUnresolved = role === "to" ? setUnresolvedIds : setUnresolvedCcIds
    const label = role === "to" ? "收件人" : "抄送"
    const fieldId = role === "to" ? "mail-recipient-picker" : "mail-cc-picker"
    const open = recipientPickerOpen && recipientPickerRole === role
    return <div className="space-y-2" key={role}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Popover open={open} onOpenChange={(next) => { setRecipientPickerRole(role); setRecipientPickerOpen(next); if (!next) setRecipientSearch("") }}>
        <PopoverTrigger asChild>
          <Button id={fieldId} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className="text-muted-foreground">{selected.length || selectedOrganizations.length ? `添加${label}` : `选择${label}`}</span><ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent portalContainer={dialogContent.current} align="start" className="w-(--radix-popover-trigger-width) p-1.5">
          <Command shouldFilter={false}>
            <CommandInput aria-label={`搜索${label}`} maxLength={100} value={recipientSearch} onValueChange={setRecipientSearch} placeholder="搜索姓名或账号" />
            <CommandList aria-label={`可选${label}`} className="max-h-56">
              <CommandGroup>{candidates.items.map((person) => <CommandItem key={person.userId} value={person.userId} data-checked={selected.some((item) => item.userId === person.userId)} className="min-h-10" onSelect={() => toggleRecipient(person, role)}><span className="min-w-0 flex-1 truncate">{personName(person)}</span>{person.handle && person.handle !== personName(person) && <span className="truncate text-xs text-muted-foreground">{person.handle}</span>}</CommandItem>)}</CommandGroup>
              <CommandGroup heading="组织">{organizations.items.map((organization) => <div key={organization.organizationId} className="flex items-center gap-1"><CommandItem value={`organization-${organization.organizationId}`} data-checked={selectedOrganizations.some((item) => item.organizationId === organization.organizationId)} className="min-h-10 min-w-0 flex-1" onSelect={() => toggleOrganization(organization, role)}><span className="min-w-0 flex-1 truncate">{organization.name} · {organization.teamName}</span><span className="text-xs text-muted-foreground">{organization.memberCount} 人</span></CommandItem><Button type="button" size="sm" variant="ghost" onClick={() => void showOrganizationMembers(organization.organizationId)}>成员</Button></div>)}</CommandGroup>
              {expandedOrganizationId && <div className="px-3 py-2 text-sm" aria-label="组织成员">{organizationMembers.map((person) => <p key={person.userId}>{personName(person)}</p>)}{organizationMemberLoading && <p>加载中…</p>}{organizationMemberCursor && <Button type="button" size="sm" variant="ghost" onClick={() => void showOrganizationMembers(expandedOrganizationId, organizationMemberCursor)}>加载更多</Button>}</div>}
              {candidates.loading && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">加载成员中…</p>}
              {!candidates.loading && !organizations.loading && !candidates.error && !organizations.error && !candidates.items.length && !organizations.items.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{recipientSearch.trim() ? "没有匹配的成员或组织" : "没有可选成员或组织"}</p>}
              {candidates.error && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="text-destructive">{candidates.error}</span><Button type="button" variant="ghost" onClick={candidates.retry}>重试</Button></div>}
              {organizations.error && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="text-destructive">{organizations.error}</span><Button type="button" variant="ghost" onClick={organizations.retry}>重试</Button></div>}
              {candidates.nextCursor && <div className="p-1 text-center"><Button type="button" variant="ghost" disabled={candidates.loadingMore} onClick={candidates.loadMore}>{candidates.loadingMore ? "加载中…" : "加载更多"}</Button></div>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {!!selected.length && <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label={`已选${label}`}>{selected.map((person) => <Button key={person.userId} type="button" variant="secondary" size="sm" className="max-w-full" aria-label={`移除 ${personName(person)}`} onClick={() => toggleRecipient(person, role)}><span className="truncate">{personName(person)}</span><X /></Button>)}</div>}
      {!!selectedOrganizations.length && <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label={`已选${label}组织`}>{selectedOrganizations.map((organization) => <Button key={organization.organizationId} type="button" variant="secondary" size="sm" className="max-w-full" aria-label={`移除组织 ${organization.name}`} onClick={() => toggleOrganization(organization, role)}><span className="truncate">{organization.name}</span><X /></Button>)}</div>}
      {!!unresolved.length && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{label}无法确认，请移除或重新搜索{unresolved.map((id) => <Button key={id} type="button" variant="outline" size="sm" onClick={() => setUnresolved((current) => current.filter((item) => item !== id))}>{id}<X /></Button>)}</div>}
    </div>
  }

  return <Dialog open={start !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent ref={dialogContent} aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{start?.relation?.kind === "reply" ? "回复" : start?.relation?.kind === "forward" ? "转发" : "写信"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {recipientField("to")}
        {recipientField("cc")}
        <div className="space-y-2"><Label htmlFor="mail-subject">主题</Label><Input id="mail-subject" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="mail-body">正文</Label><Textarea id="mail-body" rows={6} value={body} onChange={(event) => setBody(event.target.value)} /></div>
        {start?.source && <details open className="text-sm"><summary className="cursor-pointer font-medium">{start.relation?.kind === "forward" ? "转发原文" : "回复原文"}</summary><div className="mt-2 space-y-1 text-muted-foreground"><p>发件人：{personName(start.source.sender)}</p><p>收件人：{start.source.toAddresses?.map((address) => address.name).join("、") ?? start.source.toRecipients.map(personName).join("、")}</p>{!!(start.source.ccAddresses?.length ?? start.source.ccRecipients.length) && <p>抄送：{start.source.ccAddresses?.map((address) => address.name).join("、") ?? start.source.ccRecipients.map(personName).join("、")}</p>}<p>时间：{new Date(start.source.sentAt).toLocaleString()}</p><p>主题：{start.source.subject}</p><p className="whitespace-pre-wrap text-foreground">{start.source.body}</p></div></details>}
        <div className="space-y-2"><Label htmlFor="mail-attachment">附件</Label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || attachments.length + forwardAttachmentIds.length >= 10} onClick={() => fileInput.current?.click()}><Paperclip />添加附件</Button><input ref={fileInput} id="mail-attachment" type="file" className="sr-only" tabIndex={-1} onChange={(event) => { void attachLocal(event.target.files?.[0]); event.currentTarget.value = "" }} />
          {attachments.map((attachment) => <Button key={attachment.attachmentId} type="button" variant="secondary" size="sm" className="max-w-full" aria-label={`移除附件 ${attachment.fileName}`} onClick={() => setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId))}><span className="truncate">{attachment.fileName}</span><X /></Button>)}</div>
          {start?.relation?.kind === "forward" && start.source?.attachments.map((attachment) => { const selected = forwardAttachmentIds.includes(attachment.attachmentId); return <Button key={attachment.attachmentId} type="button" variant={selected ? "secondary" : "outline"} size="sm" disabled={!selected && attachments.length + forwardAttachmentIds.length >= 10} onClick={() => setForwardAttachmentIds((current) => selected ? current.filter((id) => id !== attachment.attachmentId) : [...current, attachment.attachmentId])}>{selected ? "移除" : "附上"} {attachment.fileName}</Button> })}
        </div>
      </div>
      {confirmation && <div role="status" className="space-y-1 text-sm"><p>收件人：{confirmation.toAddresses.map((address) => address.name).join("、")}</p>{!!confirmation.ccAddresses.length && <p>抄送：{confirmation.ccAddresses.map((address) => address.name).join("、")}</p>}<p>当前可投递 {confirmation.recipientCount} 人</p></div>}
      <DialogFooter><Button type="button" disabled={busy || (!recipients.length && !toOrganizations.length) || !!unresolvedIds.length || !!unresolvedCcIds.length || !subject.trim() || (start?.relation?.kind !== "forward" && !body.trim())} onClick={() => void send()}>{confirmation ? "确认发送" : "预览发送"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
