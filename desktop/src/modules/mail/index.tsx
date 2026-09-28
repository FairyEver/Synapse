import { useEffect, useState } from "react"
import { ArrowLeft, Inbox, MailOpen, Paperclip, Pencil, RefreshCw, Search, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useAccount } from "@/app-shell/account"
import { mailRequest } from "@/lib/mail-api"
import type { MailMessage, MailPerson } from "@/types/mail"
import { MailCompose, type ComposeStart } from "./compose"
import { MailLayout } from "./layout"
import { useMail, type MailBox } from "./use-mail"
import type { SynapseSystemAppMailOpenRequest } from "../apps/types"

const boxes: { id: MailBox; name: string; icon: typeof Inbox }[] = [
  { id: "inbox", name: "收件箱", icon: Inbox },
  { id: "sent", name: "已发送", icon: Send },
]
const emptyTitles: Record<MailBox, string> = { inbox: "收件箱为空", sent: "还没有已发送信件" }

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }

function MailEmptyState({ box, searched, onClearSearch, onCompose }: { box: MailBox; searched: boolean; onClearSearch: () => void; onCompose: () => void }) {
  const Icon = searched ? Search : boxes.find((entry) => entry.id === box)?.icon ?? Inbox
  return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon"><Icon /></EmptyMedia>
      <EmptyTitle>{searched ? "没有匹配的信件" : emptyTitles[box]}</EmptyTitle>
    </EmptyHeader>
    <EmptyContent>{searched ? <Button type="button" variant="outline" onClick={onClearSearch}>清除搜索</Button> : <Button type="button" variant="outline" onClick={onCompose}><Pencil />写信</Button>}</EmptyContent>
  </Empty>
}

type MailModuleProps = { openRequest?: SynapseSystemAppMailOpenRequest | null; onOpenRequestConsumed?: (requestId: string) => void }

export function MailModule(props: MailModuleProps = {}) {
  const { state } = useAccount()
  if (state.status !== "authenticated") return <p className="p-4 text-sm text-muted-foreground">登录后查看站内信</p>
  return <MailModuleContent key={state.profile.user.id} myId={state.profile.user.id} {...props} />
}

function MailModuleContent({ openRequest, onOpenRequestConsumed, myId }: MailModuleProps & { myId: string }) {
  const [box, setBox] = useState<MailBox>("inbox")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [compose, setCompose] = useState<ComposeStart | null>(null)
  const mail = useMail(box, search)
  const hasListItems = mail.messages.length > 0 || !!mail.nextCursor
  const showMessageColumns = mail.messages.length > 0 || mail.selectedId !== null
  const isEmpty = mail.ready && !mail.loading && !mail.error && !mail.selectedId && !hasListItems

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
    const recipients = all ? [message.sender, ...message.recipients] : message.sender.userId === myId ? message.recipients : [message.sender]
    const recipientIds = [...new Set(recipients.map((person) => person.userId))].filter((id) => id !== myId)
    setCompose({ recipientIds, subject: `回复：${message.subject}`, replyToId: message.messageId })
  }

  async function download(message: MailMessage, attachmentId: string) {
    try {
      await mailRequest({ kind: "attachmentDownload", messageId: message.messageId, attachmentId })
    } catch (error) { toast.error(error instanceof Error ? error.message : "下载失败。") }
  }

  async function openMessage(messageId: string, unread: boolean) {
    mail.setSelectedId(messageId)
    if (!unread) return
    try {
      await mailRequest({ kind: "messageSetRead", messageId, read: true })
      mail.refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : "已读状态更新失败。") }
  }

  return <SystemAppWindowShell left={<h2 className="text-sm font-semibold">站内信</h2>} actions={<><SystemAppTopBarActionButton iconOnly aria-label="刷新" onClick={mail.refresh}><RefreshCw /></SystemAppTopBarActionButton><SystemAppTopBarActionButton onClick={() => setCompose({})}><Pencil />写信</SystemAppTopBarActionButton></>}>
    <MailLayout navigation={<nav aria-label="信箱" className="flex shrink-0 overflow-x-auto border-b bg-sidebar p-2 @3xl/mail:block @3xl/mail:h-full @3xl/mail:border-b-0 @3xl/mail:p-3">
          {boxes.map((entry) => <Button key={entry.id} type="button" variant={box === entry.id ? "secondary" : "ghost"} className="min-w-0 flex-1 justify-center @3xl/mail:mb-1 @3xl/mail:w-full @3xl/mail:justify-start" onClick={() => { setBox(entry.id); mail.setSelectedId(null) }}><entry.icon />{entry.name}</Button>)}
        </nav>} list={<section aria-label={boxes.find((entry) => entry.id === box)?.name} className={`${mail.selectedId ? "hidden @3xl/mail:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
            <form className="flex items-center gap-2 border-b px-4 py-3" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()) }}>
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input type="search" aria-label="搜索信件" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题或正文" className="min-w-0 max-w-xl flex-1" />
              <Button type="submit" variant="secondary">搜索</Button>
            </form>
            {!mail.error && (mail.loading || !mail.ready) && !hasListItems ? <div role="status" aria-label="加载信件中" className="w-full max-w-3xl space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}
            {mail.error && !mail.messages.length ? <Empty>
              <EmptyHeader><EmptyTitle>信件加载失败</EmptyTitle><EmptyDescription role="alert">{mail.error}</EmptyDescription></EmptyHeader>
              <EmptyContent><Button type="button" variant="outline" onClick={mail.refresh}><RefreshCw />重试</Button></EmptyContent>
            </Empty> : null}
            {isEmpty && <MailEmptyState box={box} searched={!!search} onClearSearch={() => { setQuery(""); setSearch("") }} onCompose={() => setCompose({})} />}
            {hasListItems && <ScrollArea className="min-h-0 flex-1">
              {mail.error && <p role="alert" className="p-3 text-sm text-destructive">{mail.error}</p>}
              {mail.messages.map((message) => <button key={message.messageId} type="button" aria-current={mail.selectedId === message.messageId ? "true" : undefined} className={`block w-full border-b px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${mail.selectedId === message.messageId ? "bg-selected" : ""}`} onClick={() => void openMessage(message.messageId, box === "inbox" && !message.readAt)}>
                <div className="flex items-center justify-between gap-2"><span className={`flex min-w-0 items-center gap-2 truncate text-sm ${message.readAt ? "" : "font-semibold"}`}>{box === "inbox" && !message.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}{box === "inbox" ? personName(message.sender) : message.recipients.map(personName).join("、")}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(message.sentAt).toLocaleDateString()}</span></div>
                <span className={`block truncate text-sm ${message.readAt ? "" : "font-medium"}`}>{message.subject}</span><span className="block truncate text-xs text-muted-foreground">{message.snippet}</span>
              </button>)}
              {mail.nextCursor && <Button type="button" variant="ghost" className="w-full" onClick={() => void mail.loadMore().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "加载失败。"))}>加载更多</Button>}
            </ScrollArea>}
          </section>} detail={showMessageColumns ? <section aria-label="信件内容" className={`${mail.selectedId ? "block" : "hidden @3xl/mail:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-6`}>
            {mail.selectedId && <Button type="button" variant="ghost" className="mb-4 self-start @3xl/mail:hidden" onClick={() => mail.setSelectedId(null)}><ArrowLeft />返回列表</Button>}
            {mail.detail ? <article className="mx-auto w-full max-w-3xl">
              <h3 className="text-xl font-semibold">{mail.detail.subject}</h3>
              <p className="mt-3 text-sm">{personName(mail.detail.sender)} → {mail.detail.recipients.map(personName).join("、")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(mail.detail.sentAt).toLocaleString()}</p>
              <div className="mt-5 flex flex-wrap gap-1 border-b pb-4"><Button size="sm" variant="ghost" onClick={() => reply(false)}>回复</Button><Button size="sm" variant="ghost" onClick={() => reply(true)}>回复全部</Button><Button size="sm" variant="ghost" onClick={() => setCompose({ subject: `转发：${mail.detail!.subject}`, body: `\n\n${mail.detail!.body}`, replyToId: mail.detail!.messageId })}>转发</Button>{box === "inbox" && <Button size="sm" variant="ghost" onClick={() => void setRead(!mail.detail?.readAt)}>{mail.detail.readAt ? "设为未读" : "设为已读"}</Button>}<Button size="sm" variant="destructive" onClick={() => void remove()}>删除</Button></div>
              <p className="mt-6 whitespace-pre-wrap text-sm leading-7">{mail.detail.body}</p>
              {!!mail.detail.attachments.length && <div className="mt-8 border-t pt-4"><h4 className="text-sm font-medium">附件</h4>{mail.detail.attachments.map((attachment) => <Button key={attachment.attachmentId} variant="ghost" className="mt-2" onClick={() => void download(mail.detail!, attachment.attachmentId)}><Paperclip />{attachment.fileName}</Button>)}</div>}
            </article> : mail.selectedId ? mail.error ? <Empty><EmptyHeader><EmptyTitle>信件加载失败</EmptyTitle><EmptyDescription role="alert">{mail.error}</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" variant="outline" onClick={mail.refresh}><RefreshCw />重试</Button></EmptyContent></Empty> : <div role="status" aria-label="加载信件内容中" className="mx-auto w-full max-w-3xl space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><MailOpen /></EmptyMedia><EmptyTitle>选择一封信件</EmptyTitle></EmptyHeader></Empty>}
          </section> : null} showDetail={showMessageColumns} />
    <MailCompose start={compose} onClose={() => setCompose(null)} onSent={() => { mail.setSelectedId(null); setBox("sent"); mail.refresh() }} />
  </SystemAppWindowShell>
}
