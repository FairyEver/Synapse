import { useState } from "react"
import { ArrowLeft, ArrowRight, Bell, MoreHorizontal, Trash2, X } from "lucide-react"
import { useMessageCenter, type MessageFilter } from "@/app-shell/hooks/use-message-center"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { MailAddress, MailPerson } from "@/types/mail"
import type { SynapseNotification } from "@/types/notification-center"

type Center = ReturnType<typeof useMessageCenter>

function sourceName(item: SynapseNotification): string {
  if (item.source === "mail") return "站内信"
  if (item.source.startsWith("terminal-")) return "终端"
  if (item.source === "meeting-transcription") return "录音"
  if (item.source === "external") return item.group || "外部通知"
  return "Synapse"
}

function isPending(item: SynapseNotification): boolean {
  return item.source === "terminal-attention" && !item.resolvedAt
}

function dateLabel(value: string): string {
  const date = new Date(value)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date >= today) return "今天"
  if (date >= yesterday) return "昨天"
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
}

function personName(person: MailPerson): string { return person.nickname || person.handle || person.userId }
function recipientNames(addresses: MailAddress[] | undefined, people: MailPerson[]): string {
  return addresses ? addresses.map((address) => address.name).join("、") : people.map(personName).join("、")
}

function primaryAction(item: SynapseNotification): string | null {
  if (item.source === "mail" && item.targetId) return "在站内信中打开"
  if (isPending(item) && item.targetId) return "前往处理"
  if (item.targetId && item.source.startsWith("terminal-")) return "打开会话"
  if (item.targetId && item.source === "meeting-transcription") return "打开录音"
  if (item.url) return "打开链接"
  return null
}

function MessageDetail({ center }: { center: Center }) {
  const item = center.selected
  if (!item) return <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">选择一条通知查看内容</div>
  const isMail = item.source === "mail" && !!item.targetId
  const mail = center.mail?.messageId === item.targetId ? center.mail : null
  const action = primaryAction(item)

  return <article className="mx-auto w-full max-w-2xl">
    <div className="mb-7 flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 @3xl/message-center:hidden" onClick={center.closeDetail}><ArrowLeft />返回列表</Button>
      <span className="text-xs text-muted-foreground">{sourceName(item)}{isPending(item) && " · 待处理"}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="通知操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { void center.setRead(item, !item.readAt) }}>{item.readAt ? "标记为未读" : "标记为已读"}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => center.remove(item)}>删除通知</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {isMail && center.mailLoading && !mail ? <div role="status" aria-label="加载站内信中" className="space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-28 w-full" /></div> : <>
      <h3 className="text-xl font-semibold leading-snug">{mail?.subject ?? item.title}</h3>
      {isMail && mail ? <dl className="mt-5 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">发件人</dt><dd>{personName(mail.sender)}</dd>
        <dt className="text-muted-foreground">收件人</dt><dd>{recipientNames(mail.toAddresses, mail.toRecipients)}</dd>
        <dt className="text-muted-foreground">时间</dt><dd>{new Date(mail.sentAt).toLocaleString("zh-CN")}</dd>
      </dl> : <dl className="mt-5 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">来源</dt><dd>{sourceName(item)}</dd>
        <dt className="text-muted-foreground">时间</dt><dd>{new Date(item.createdAt).toLocaleString("zh-CN")}</dd>
      </dl>}
      <div className="mt-7 border-t pt-6">
        {isMail && center.mailError && <div role="alert" className="mb-4 flex items-center gap-2 text-sm text-destructive">{center.mailError}<Button type="button" variant="outline" size="sm" onClick={center.retryMail}>重试</Button></div>}
        <MarkdownViewer content={mail?.body ?? item.body} showTabs={false} surface="plain" />
        {mail && mail.attachments.length > 0 && <p className="mt-5 text-sm text-muted-foreground">{mail.attachments.length} 个附件，请在站内信中查看</p>}
      </div>
      <div className="mt-7 flex flex-wrap gap-2">
        {action && <Button type="button" size="sm" onClick={() => { void center.navigate(item) }}>{action}<ArrowRight /></Button>}
        <Button type="button" variant="outline" size="sm" onClick={() => center.remove(item)}><Trash2 />删除通知</Button>
      </div>
    </>}
  </article>
}

function MessageCenter({ onOpenMeeting }: { onOpenMeeting?: (meetingId: string) => void }) {
  const center = useMessageCenter(onOpenMeeting)
  const [clearScope, setClearScope] = useState<"all" | "pending" | null>(null)
  if (!center.authenticated) return null

  let previousDate = ""
  return <>
    <Sheet open={center.open} onOpenChange={center.changeOpen}>
      <SheetTrigger asChild><Button variant="ghost" size="sm" aria-label={`通知，${center.unread} 条未读`} className="gap-1.5"><Bell className="size-4" />通知{center.unread > 0 && <Badge variant="secondary">{center.unread > 99 ? "99+" : center.unread}</Badge>}</Button></SheetTrigger>
      <SheetContent showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={(event) => event.preventDefault()} className="@container/message-center gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader className="flex h-16 shrink-0 flex-row items-center justify-between gap-3 border-b px-5 py-0">
          <div className="flex items-center gap-2"><SheetTitle className="text-lg font-semibold">通知</SheetTitle>{center.unread > 0 && <Badge variant="secondary">{center.unread}</Badge>}</div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={!center.unread} onClick={() => { void center.markAllRead() }}>全部设为已读</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="更多操作"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setClearScope("all")}>清空全部通知…</DropdownMenuItem><DropdownMenuItem onSelect={() => { void center.openApiGuide() }}>通知 API 文档</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭通知中心" onClick={() => center.changeOpen(false)}><X /></Button>
          </div>
        </SheetHeader>
        <div className="flex min-h-0 flex-1">
          <section aria-label="通知列表" className={`${center.selected ? "hidden @3xl/message-center:flex" : "flex"} min-h-0 min-w-0 w-full flex-col @3xl/message-center:w-96 @3xl/message-center:shrink-0 @3xl/message-center:border-r`}>
            <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-3">
              <Tabs value={center.filter} onValueChange={(value) => center.changeFilter(value as MessageFilter)}><TabsList><TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="unread">未读{center.unread > 0 && ` ${center.unread}`}</TabsTrigger><TabsTrigger value="pending">待处理</TabsTrigger></TabsList></Tabs>
              {center.filter === "pending" && center.items.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setClearScope("pending")}>忽略全部…</Button>}
              {center.filter === "unread" && center.items.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { void center.markAllRead() }}>全部已读</Button>}
            </div>
            {center.error && <div role="alert" className="flex items-center gap-2 border-b px-4 py-2 text-sm text-destructive">{center.error}<Button type="button" variant="outline" size="sm" onClick={() => { void center.refresh() }}>重试</Button></div>}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {center.loading && center.items.length === 0 && <div role="status" aria-label="加载通知中" className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
              {!center.loading && !center.error && center.items.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">这里没有通知</div>}
              {center.items.map((item) => {
                const date = dateLabel(item.createdAt)
                const showDate = date !== previousDate
                previousDate = date
                return <div key={item.id}>
                  {showDate && <h3 className="px-5 pb-2 pt-5 text-xs font-medium text-muted-foreground">{date}</h3>}
                  <button type="button" aria-current={center.selected?.id === item.id ? "true" : undefined} className={`grid w-full grid-cols-[0.5rem_minmax(0,1fr)] gap-2.5 border-b px-5 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${center.selected?.id === item.id ? "bg-selected" : ""}`} onClick={() => { void center.openItem(item) }}>
                    <span className={`mt-1.5 size-2 rounded-full ${item.readAt ? "bg-transparent" : "bg-primary"}`} aria-hidden="true" />
                    <span className="min-w-0"><span className="flex items-baseline justify-between gap-2"><span className={`min-w-0 truncate text-sm ${item.readAt ? "font-medium" : "font-semibold"}`}>{item.title}</span><time className="shrink-0 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></span><span className="mt-1 block text-xs text-muted-foreground">{sourceName(item)}{isPending(item) && <span className="font-medium text-foreground"> · 待处理</span>}</span><span className="mt-0.5 block truncate text-sm text-muted-foreground">{item.body}</span></span>
                  </button>
                </div>
              })}
              {center.cursor && <Button type="button" variant="ghost" className="w-full" onClick={() => { void center.loadMore() }}>加载更多</Button>}
            </div>
          </section>
          <section aria-label="通知内容" className={`${center.selected ? "block" : "hidden @3xl/message-center:block"} min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-7 @3xl/message-center:px-9`}><MessageDetail center={center} /></section>
        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={clearScope !== null} onOpenChange={(open) => { if (!open) setClearScope(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{clearScope === "pending" ? "忽略全部待处理通知？" : "清空全部通知？"}</AlertDialogTitle><AlertDialogDescription>{clearScope === "pending" ? "通知会从列表中移除，终端中的待处理状态不会改变。" : "这些通知会从当前账号的所有设备中移除，包括未加载的通知。"}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (clearScope) void center.deleteAll(clearScope) }}>{clearScope === "pending" ? "确认忽略" : "确认清空"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}

export { MessageCenter }
