import { useEffect, useState } from "react"
import { Paperclip, Pencil, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailDraft, MailMessage, MailPerson } from "@/types/mail"
import { MailCompose, type ComposeStart } from "./compose"
import { useMail, type MailBox } from "./use-mail"
import type { SynapseSystemAppMailOpenRequest } from "../apps/types"

const boxes: { id: MailBox; name: string }[] = [{ id: "inbox", name: "收件箱" }, { id: "sent", name: "已发送" }, { id: "drafts", name: "草稿箱" }]

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }

export function MailModule({ openRequest, onOpenRequestConsumed }: { openRequest?: SynapseSystemAppMailOpenRequest | null; onOpenRequestConsumed?: (requestId: string) => void } = {}) {
  const [box, setBox] = useState<MailBox>("inbox")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [compose, setCompose] = useState<ComposeStart | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const mail = useMail(box, search)

  useEffect(() => {
    void getSynapseBridge()?.account.state.get().then((state) => setMyId(state.status === "authenticated" ? state.profile.user.id : null))
  }, [])

  useEffect(() => {
    if (!openRequest) return
    setBox("inbox")
    mail.setSelectedId(openRequest.messageId)
    onOpenRequestConsumed?.(openRequest.requestId)
  }, [openRequest, onOpenRequestConsumed, mail.setSelectedId])

  async function setRead(read: boolean) {
    if (!mail.detail) return
    try {
      await mailRequest({ kind: "messageSetRead", messageId: mail.detail.messageId, read })
      mail.refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : "状态更新失败。") }
  }

  async function remove() {
    if (!mail.detail) return
    try {
      await mailRequest({ kind: "messageDelete", messageId: mail.detail.messageId })
      mail.setSelectedId(null)
      mail.refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : "删除失败。") }
  }

  function reply(all: boolean) {
    const message = mail.detail
    if (!message) return
    const recipients = all ? [message.sender, ...message.recipients] : [message.sender]
    const recipientIds = [...new Set(recipients.map((person) => person.userId))].filter((id) => id !== myId)
    setCompose({ recipientIds, subject: `回复：${message.subject}`, replyToId: message.messageId })
  }

  async function download(message: MailMessage, attachmentId: string) {
    try {
      await mailRequest({ kind: "attachmentDownload", messageId: message.messageId, attachmentId })
    } catch (error) { toast.error(error instanceof Error ? error.message : "下载失败。") }
  }

  return <SystemAppWindowShell left={<h2 className="text-sm font-semibold">站内信</h2>} actions={<><Button size="sm" variant="ghost" aria-label="刷新" onClick={mail.refresh}><RefreshCw /></Button><Button size="sm" onClick={() => setCompose({})}><Pencil />写信</Button></>}>
    <div className="grid h-full min-h-0 grid-cols-[10rem_minmax(16rem,22rem)_minmax(0,1fr)] bg-surface">
      <nav aria-label="信箱" className="border-r p-3">
        {boxes.map((entry) => <Button key={entry.id} type="button" variant={box === entry.id ? "secondary" : "ghost"} className="mb-1 w-full justify-start" onClick={() => { setBox(entry.id); mail.setSelectedId(null) }}>{entry.name}</Button>)}
      </nav>
      <section aria-label={boxes.find((entry) => entry.id === box)?.name} className="flex min-h-0 flex-col border-r">
        {box !== "drafts" && <form className="flex items-center gap-2 border-b p-2" onSubmit={(event) => { event.preventDefault(); setSearch(query) }}><Search className="size-4 shrink-0 text-muted-foreground" /><Input aria-label="搜索信件" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题或正文" className="border-0 shadow-none" /></form>}
        <ScrollArea className="min-h-0 flex-1">
          {mail.error && <p role="alert" className="p-3 text-sm text-destructive">{mail.error}</p>}
          {mail.loading && <p className="p-3 text-sm text-muted-foreground">加载中…</p>}
          {!mail.loading && box === "drafts" && !mail.drafts.length && <p className="p-3 text-sm text-muted-foreground">没有草稿</p>}
          {!mail.loading && box !== "drafts" && !mail.messages.length && <p className="p-3 text-sm text-muted-foreground">没有信件</p>}
          {box === "drafts" ? mail.drafts.map((draft: MailDraft) => <button key={draft.draftId} type="button" className="block w-full border-b px-3 py-3 text-left hover:bg-accent" onClick={() => setCompose({ draft })}><span className="block truncate text-sm font-medium">{draft.subject || "无主题"}</span><span className="block truncate text-xs text-muted-foreground">{draft.body}</span></button>) : mail.messages.map((message) => <button key={message.messageId} type="button" className={`block w-full border-b px-3 py-3 text-left hover:bg-accent ${mail.selectedId === message.messageId ? "bg-accent" : ""}`} onClick={() => { mail.setSelectedId(message.messageId); if (box === "inbox" && !message.readAt) void mailRequest({ kind: "messageSetRead", messageId: message.messageId, read: true }).then(mail.refresh) }}>
            <div className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${message.readAt ? "" : "font-semibold"}`}>{box === "inbox" ? personName(message.sender) : message.recipients.map(personName).join("、")}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(message.sentAt).toLocaleDateString()}</span></div>
            <span className="block truncate text-sm">{message.subject}</span><span className="block truncate text-xs text-muted-foreground">{message.snippet}</span>
          </button>)}
          {mail.nextCursor && <Button type="button" variant="ghost" className="w-full" onClick={() => void mail.loadMore()}>加载更多</Button>}
        </ScrollArea>
      </section>
      <section aria-label="信件内容" className="min-h-0 overflow-y-auto p-6">
        {mail.detail && box !== "drafts" ? <article className="mx-auto max-w-3xl">
          <h3 className="text-xl font-semibold">{mail.detail.subject}</h3>
          <p className="mt-3 text-sm">{personName(mail.detail.sender)} → {mail.detail.recipients.map(personName).join("、")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{new Date(mail.detail.sentAt).toLocaleString()}</p>
          <div className="mt-5 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => reply(false)}>回复</Button><Button size="sm" variant="outline" onClick={() => reply(true)}>回复全部</Button><Button size="sm" variant="outline" onClick={() => setCompose({ subject: `转发：${mail.detail!.subject}`, body: `\n\n${mail.detail!.body}`, replyToId: mail.detail!.messageId })}>转发</Button>{box === "inbox" && <Button size="sm" variant="outline" onClick={() => void setRead(Boolean(mail.detail?.readAt) ? false : true)}>{mail.detail.readAt ? "设为未读" : "设为已读"}</Button>}<Button size="sm" variant="outline" onClick={() => void remove()}>删除</Button></div>
          <p className="mt-8 whitespace-pre-wrap text-sm leading-7">{mail.detail.body}</p>
          {!!mail.detail.attachments.length && <div className="mt-8 border-t pt-4"><h4 className="text-sm font-medium">附件</h4>{mail.detail.attachments.map((attachment) => <Button key={attachment.attachmentId} variant="ghost" className="mt-2" onClick={() => void download(mail.detail!, attachment.attachmentId)}><Paperclip />{attachment.fileName}</Button>)}</div>}
        </article> : <p className="text-sm text-muted-foreground">选择信件</p>}
      </section>
    </div>
    <MailCompose start={compose} onClose={() => setCompose(null)} onSent={() => { setBox("sent"); mail.refresh() }} />
  </SystemAppWindowShell>
}
