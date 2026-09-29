import { useEffect, useState } from "react"
import { ArrowLeft, Check, Inbox, MailOpen, Paperclip, Pencil, RefreshCw, Search, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useAccount } from "@/app-shell/account"
import { mailRequest } from "@/lib/mail-api"
import type { MailAddress, MailMessage, MailPerson } from "@/types/mail"
import { MailCompose, type ComposeStart } from "./compose"
import { MailLayout } from "./layout"
import { useMail, type MailBox } from "./use-mail"
import { useMailContext } from "./use-mail-context"
import type { SynapseSystemAppMailOpenRequest } from "../apps/types"

const boxes: { id: MailBox; name: string; icon: typeof Inbox }[] = [
  { id: "inbox", name: "收件箱", icon: Inbox },
  { id: "sent", name: "已发送", icon: Send },
]
const emptyTitles: Record<MailBox, string> = { inbox: "收件箱为空", sent: "还没有已发送信件" }

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }
function addressNames(addresses: MailAddress[] | undefined, people: MailPerson[]): string { return addresses ? addresses.map((address) => address.name).join("、") : people.map(personName).join("、") }

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
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<"selected" | "all" | null>(null)
  const [compose, setCompose] = useState<ComposeStart | null>(null)
  const mail = useMail(box, search, box === "inbox" && unreadOnly)
  const context = useMailContext(mail.detail?.messageId === mail.selectedId && !mail.detail.legacyFormat ? mail.selectedId : null)
  const hasListItems = mail.messages.length > 0 || !!mail.nextCursor
  const showMessageColumns = mail.messages.length > 0 || mail.selectedId !== null
  const isEmpty = mail.ready && !mail.loading && !mail.error && !mail.selectedId && !hasListItems

  useEffect(() => { setSelectedIds(new Set()); setSelecting(false) }, [box, search, unreadOnly])

  function toggleSelected(messageId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function markAllRead() {
    try { await mailRequest({ kind: "messageReadAll" }); mail.refresh() }
    catch (error) { toast.error(error instanceof Error ? error.message : "操作失败。") }
  }

  async function performDelete() {
    if (!pendingDelete) return
    try {
      if (pendingDelete === "selected") {
        const ids = [...selectedIds]
        let skipped = 0
        for (let offset = 0; offset < ids.length; offset += 100) {
          const result = await mailRequest({ kind: "messageDeleteBatch", messageIds: ids.slice(offset, offset + 100) })
          skipped += result.skippedIds.length
        }
        if (skipped) toast.error(`${skipped} 封信件未处理`)
      } else {
        await mailRequest({ kind: "messageDeleteAll", box })
      }
      mail.setSelectedId(null)
      setSelectedIds(new Set())
      setSelecting(false)
      mail.refresh()
    } catch (error) { mail.refresh(); toast.error(error instanceof Error ? error.message : "删除失败。") }
  }

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

  function reply() {
    const message = mail.detail
    if (!message || message.kind === "platform_broadcast") return
    const to = message.sender.userId === myId ? message.toRecipients : [message.sender]
    const toIds = [...new Set(to.map((person) => person.userId))].filter((id) => id !== myId)
    const ccIds: string[] = []
    setCompose({ toIds, ccIds, subject: `回复：${message.subject}`, relation: { kind: "reply", messageId: message.messageId }, source: message })
  }

  function forward() {
    if (!mail.detail || mail.detail.kind === "platform_broadcast") return
    setCompose({ subject: `转发：${mail.detail.subject}`, relation: { kind: "forward", messageId: mail.detail.messageId }, source: mail.detail })
  }

  async function download(message: MailMessage, attachmentId: string) {
    try {
      await mailRequest({ kind: "attachmentDownload", messageId: message.messageId, attachmentId })
    } catch (error) { toast.error(error instanceof Error ? error.message : "下载失败。") }
  }

  function openMessage(messageId: string) {
    mail.setSelectedId(messageId)
  }

  return <SystemAppWindowShell left={<h2 className="text-sm font-semibold">站内信</h2>} actions={<><SystemAppTopBarActionButton iconOnly aria-label="刷新" onClick={mail.refresh}><RefreshCw /></SystemAppTopBarActionButton><SystemAppTopBarActionButton onClick={() => setCompose({})}><Pencil />写信</SystemAppTopBarActionButton></>}>
    <MailLayout navigation={<nav aria-label="信箱" className="flex shrink-0 overflow-x-auto border-b bg-sidebar p-2 @3xl/mail:block @3xl/mail:h-full @3xl/mail:border-b-0 @3xl/mail:p-3">
          {boxes.map((entry) => <Button key={entry.id} type="button" variant={box === entry.id ? "secondary" : "ghost"} className="min-w-0 flex-1 justify-center @3xl/mail:mb-1 @3xl/mail:w-full @3xl/mail:justify-start" onClick={() => { setBox(entry.id); mail.setSelectedId(null) }}><entry.icon />{entry.name}</Button>)}
        </nav>} list={<section aria-label={boxes.find((entry) => entry.id === box)?.name} className={`${mail.selectedId ? "hidden @3xl/mail:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
            <form className="flex h-10 items-center border-b px-2 focus-within:border-foreground focus-within:bg-muted" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()) }}>
              <Input type="search" aria-label="搜索信件" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题或正文" className="h-full flex-1 rounded-none border-0 px-2 focus-visible:ring-0 dark:bg-transparent" />
              <Button type="submit" variant="ghost" size="icon" className="size-10" aria-label="搜索"><Search /></Button>
            </form>
            <div className="flex flex-wrap items-center gap-1 border-b p-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelecting(!selecting); setSelectedIds(new Set()); mail.setSelectedId(null) }}>{selecting ? "取消选择" : "选择"}</Button>
              {selecting && <Button type="button" size="sm" variant="destructive" disabled={!selectedIds.size} onClick={() => setPendingDelete("selected")}>删除选中（{selectedIds.size}）</Button>}
              {box === "inbox" && <><Button type="button" size="sm" variant={unreadOnly ? "secondary" : "ghost"} onClick={() => setUnreadOnly(!unreadOnly)}>只看未读</Button><Button type="button" size="sm" variant="ghost" disabled={!mail.counts?.unread} onClick={() => void markAllRead()}>全部设已读</Button></>}
              <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setPendingDelete("all")}>清空{box === "inbox" ? "收件箱" : "已发送"}</Button>
            </div>
            {!mail.error && (mail.loading || !mail.ready) && !hasListItems ? <div role="status" aria-label="加载信件中" className="w-full max-w-3xl space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : null}
            {mail.error && !mail.messages.length ? <Empty>
              <EmptyHeader><EmptyTitle>信件加载失败</EmptyTitle><EmptyDescription role="alert">{mail.error}</EmptyDescription></EmptyHeader>
              <EmptyContent><Button type="button" variant="outline" onClick={mail.refresh}><RefreshCw />重试</Button></EmptyContent>
            </Empty> : null}
            {isEmpty && <MailEmptyState box={box} searched={!!search} onClearSearch={() => { setQuery(""); setSearch("") }} onCompose={() => setCompose({})} />}
            {hasListItems && <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full">
              {mail.error && <p role="alert" className="p-3 text-sm text-destructive">{mail.error}</p>}
              {mail.messages.map((message) => <button key={message.messageId} type="button" aria-current={!selecting && mail.selectedId === message.messageId ? "true" : undefined} aria-pressed={selecting ? selectedIds.has(message.messageId) : undefined} className={`block w-full border-b px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${mail.selectedId === message.messageId || selectedIds.has(message.messageId) ? "bg-selected" : ""}`} onClick={() => selecting ? toggleSelected(message.messageId) : openMessage(message.messageId)}>
                {selecting && <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Check className={selectedIds.has(message.messageId) ? "size-3" : "size-3 opacity-0"} />{selectedIds.has(message.messageId) ? "已选中" : "选择"}</span>}
                <div className="flex items-center justify-between gap-2"><span className={`flex min-w-0 flex-1 items-center gap-2 text-sm ${message.readAt ? "" : "font-semibold"}`}>{box === "inbox" && !message.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}<span className="min-w-0 truncate">{box === "inbox" ? personName(message.sender) : addressNames(message.toAddresses, message.toRecipients)}</span></span><span className="shrink-0 text-xs text-muted-foreground">{new Date(message.sentAt).toLocaleDateString()}</span></div>
                <span className={`block truncate text-sm ${message.readAt ? "" : "font-medium"}`}>{message.relationKind === "reply" ? "回复 · " : message.relationKind === "forward" ? "转发 · " : ""}{message.subject}</span><span className="block truncate text-xs text-muted-foreground">{message.snippet}</span>
              </button>)}
              {mail.nextCursor && <Button type="button" variant="ghost" className="w-full" onClick={() => void mail.loadMore().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "加载失败。"))}>加载更多</Button>}
            </ScrollArea>}
          </section>} detail={showMessageColumns ? <section aria-label="信件内容" className={`${mail.selectedId ? "block" : "hidden @3xl/mail:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-6`}>
            {mail.selectedId && <Button type="button" variant="ghost" className="mb-4 self-start @3xl/mail:hidden" onClick={() => mail.setSelectedId(null)}><ArrowLeft />返回列表</Button>}
            {mail.detail ? <article className="mx-auto w-full max-w-3xl">
              <h3 className="text-xl font-semibold">{mail.detail.subject}</h3>
              {mail.detail.relationKind && <p className="mt-2 text-xs text-muted-foreground">{mail.detail.relationKind === "reply" ? "回复" : "转发"}</p>}
              <p className="mt-3 text-sm">发件人：{personName(mail.detail.sender)}</p>
              <p className="mt-1 text-sm">收件人：{addressNames(mail.detail.toAddresses, mail.detail.toRecipients)}</p>
              {!!(mail.detail.ccAddresses?.length ?? mail.detail.ccRecipients.length) && <p className="mt-1 text-sm">抄送：{addressNames(mail.detail.ccAddresses, mail.detail.ccRecipients)}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{new Date(mail.detail.sentAt).toLocaleString()}</p>
              <div className="mt-5 flex flex-wrap gap-1 border-b pb-4">{mail.detail.kind !== "platform_broadcast" && <><Button size="sm" variant="ghost" onClick={reply}>回复</Button><Button size="sm" variant="ghost" onClick={forward}>转发</Button></>}{box === "inbox" && <Button size="sm" variant="ghost" onClick={() => void setRead(!mail.detail?.readAt)}>{mail.detail.readAt ? "设为未读" : "设为已读"}</Button>}<Button size="sm" variant="destructive" onClick={() => void remove()}>删除</Button></div>
              <p className="mt-6 whitespace-pre-wrap text-sm leading-7">{mail.detail.body}</p>
              {mail.detail.quote && <details className="mt-6 text-sm"><summary className="cursor-pointer font-medium">{mail.detail.relationKind === "forward" ? "转发原文" : "回复原文"}</summary><div className="mt-2 space-y-1 text-muted-foreground"><p>发件人：{personName(mail.detail.quote.sender)}</p><p>收件人：{addressNames(mail.detail.quote.toAddresses, mail.detail.quote.toRecipients)}</p>{!!(mail.detail.quote.ccAddresses?.length ?? mail.detail.quote.ccRecipients.length) && <p>抄送：{addressNames(mail.detail.quote.ccAddresses, mail.detail.quote.ccRecipients)}</p>}<p>时间：{new Date(mail.detail.quote.sentAt).toLocaleString()}</p><p>主题：{mail.detail.quote.subject}</p><p className="whitespace-pre-wrap text-foreground">{mail.detail.quote.body}</p></div></details>}
              {!!mail.detail.attachments.length && <div className="mt-8 border-t pt-4"><h4 className="text-sm font-medium">附件</h4>{mail.detail.attachments.map((attachment) => <Button key={attachment.attachmentId} variant="ghost" className="mt-2" onClick={() => void download(mail.detail!, attachment.attachmentId)}><Paperclip />{attachment.fileName}</Button>)}</div>}
              {(context.items.length > 1 || context.nextCursor || context.error) && <section aria-label="关联往来" className="mt-8 border-t pt-4"><h4 className="text-sm font-medium">关联往来</h4>{context.error && <p role="alert" className="mt-2 text-sm text-destructive">{context.error}</p>}{context.items.filter((item) => item.messageId !== mail.selectedId).map((item) => <Button key={item.messageId} type="button" variant="ghost" className="mt-2 flex w-full justify-start gap-2" onClick={() => openMessage(item.messageId)}><span className="truncate">{personName(item.sender)} · {item.subject}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{new Date(item.sentAt).toLocaleDateString()}</span></Button>)}{context.nextCursor && <Button type="button" variant="ghost" onClick={() => void context.loadMore().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "加载失败。"))}>加载更早往来</Button>}</section>}
            </article> : mail.selectedId ? mail.error ? <Empty><EmptyHeader><EmptyTitle>信件加载失败</EmptyTitle><EmptyDescription role="alert">{mail.error}</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" variant="outline" onClick={mail.refresh}><RefreshCw />重试</Button></EmptyContent></Empty> : <div role="status" aria-label="加载信件内容中" className="mx-auto w-full max-w-3xl space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><MailOpen /></EmptyMedia><EmptyTitle>选择一封信件</EmptyTitle></EmptyHeader></Empty>}
          </section> : null} showDetail={showMessageColumns} />
    <MailCompose start={compose} onClose={() => setCompose(null)} onSent={() => { mail.setSelectedId(null); setBox("sent"); mail.refresh() }} />
    <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{pendingDelete === "selected" ? `删除选中的 ${selectedIds.size} 封信件？` : `清空${box === "inbox" ? "收件箱" : "已发送"}？`}</AlertDialogTitle><AlertDialogDescription>{pendingDelete === "selected" ? "只从你的信箱隐藏选中的信件。" : `将清空整个${box === "inbox" ? "收件箱" : "已发送"}，包括搜索结果和未加载的信件。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void performDelete()}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </SystemAppWindowShell>
}
