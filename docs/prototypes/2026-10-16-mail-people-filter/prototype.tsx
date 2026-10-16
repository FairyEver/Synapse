import { createRoot } from "react-dom/client"
import { ArrowLeft, Building2, Check, ChevronDown, Inbox, Mail, MailOpen, Moon, RotateCcw, Search, Send, ShieldCheck, Sun, Trash2, UserRound, UsersRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyContent } from "@/components/ui/empty"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { MailLayout } from "@/modules/mail/layout"
import { cn } from "@/lib/utils"
import { dateLabel, partyNames, unreadLabel, type Contact, type Message, type Party } from "./model"
import { usePrototype, type Prototype } from "./use-prototype"

function PartyIcon({ kind }: { kind: Party["kind"] }) {
  const Icon = kind === "system" ? ShieldCheck : kind === "organization" ? Building2 : UserRound
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
}
function ContactRow({ contact, app }: { contact: Contact; app: Prototype }) {
  const duplicate = app.contacts.some(item => item.id !== contact.id && item.name === contact.name)
  const selected = app.contact?.id === contact.id
  const identity = duplicate ? contact.identity : undefined
  const name = `${contact.name}${identity ? ` ${identity}` : ""}`
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" className={cn("w-full justify-start", selected && "bg-selected")} aria-pressed={selected} aria-label={`${name}${app.box === "inbox" && contact.unread ? `，${contact.unread} 封未读` : ""}`} data-contact={contact.id} onClick={() => app.chooseContact(contact)}>
        <PartyIcon kind={contact.kind} />
        <span className={cn("min-w-0 flex-1 truncate text-left", app.box === "inbox" && contact.unread > 0 && "font-semibold")}>{contact.name}{identity && <span className="ml-1 text-xs font-normal text-muted-foreground">{identity}</span>}</span>
        {contact.kind === "system" && <span className="text-xs font-normal text-muted-foreground">系统</span>}
        {app.box === "inbox" && contact.unread > 0 && <span className="min-w-4 shrink-0 text-right text-xs tabular-nums" aria-hidden="true">{unreadLabel(contact.unread)}</span>}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">{name}{contact.kind === "organization" && contact.identity ? ` · ${contact.identity}` : ""}</TooltipContent>
  </Tooltip>
}
function ContactList({ app, location }: { app: Prototype; location: "sidebar" | "picker" }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3" data-contact-list={location}>
    <Input type="search" value={app.partySearch} onChange={event => app.setPartySearch(event.target.value)} placeholder={`查找${app.partyLabel}`} aria-label={`查找${app.partyLabel}`} />
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
      <Button variant="ghost" className={cn("w-full justify-start", !app.contact && "bg-selected")} aria-pressed={!app.contact} onClick={() => app.chooseContact(null)}><UsersRound className="text-muted-foreground" />全部{app.partyLabel}</Button>
      {app.foundContacts.map(contact => <ContactRow key={contact.id} contact={contact} app={app} />)}
      {!app.foundContacts.length && <p className="px-2.5 py-3 text-sm text-muted-foreground">{app.partySearch ? "没有匹配的结果" : `暂无${app.partyLabel}`}</p>}
    </div>
  </div>
}
function Navigation({ app }: { app: Prototype }) {
  return <aside className="flex shrink-0 flex-col border-b border-border bg-sidebar p-3 @3xl/mail:h-full @3xl/mail:min-h-0 @3xl/mail:border-b-0">
    <nav aria-label="信箱" className="flex gap-1 @3xl/mail:flex-col">
      <Button variant={app.box === "inbox" ? "secondary" : "ghost"} aria-current={app.box === "inbox" ? "page" : undefined} data-box="inbox" className="min-w-0 flex-1 justify-start" onClick={() => app.chooseBox("inbox")}><Inbox />收件箱{app.totalUnread > 0 && <span className="ml-auto text-xs tabular-nums" aria-label={`${app.totalUnread} 封未读`}>{unreadLabel(app.totalUnread)}</span>}</Button>
      <Button variant={app.box === "sent" ? "secondary" : "ghost"} aria-current={app.box === "sent" ? "page" : undefined} data-box="sent" className="min-w-0 flex-1 justify-start" onClick={() => app.chooseBox("sent")}><Send />已发送</Button>
    </nav>
    <section aria-label={app.partyLabel} className="mt-7 hidden min-h-0 flex-1 flex-col gap-3 @3xl/mail:flex">
      <h2 className="px-2.5 text-xs font-medium text-muted-foreground">{app.partyLabel}</h2>
      <ContactList app={app} location="sidebar" />
    </section>
    <div className="mt-3 @3xl/mail:hidden">
      <Popover open={app.pickerOpen} onOpenChange={app.setPickerOpen}>
        <PopoverTrigger asChild><Button variant="outline" className="w-full justify-between" aria-label={`选择${app.partyLabel}`}><span className="truncate">{app.contact?.name ?? `全部${app.partyLabel}`}</span><ChevronDown /></Button></PopoverTrigger>
        <PopoverContent align="start" className="max-h-96"><ContactList app={app} location="picker" /></PopoverContent>
      </Popover>
    </div>
  </aside>
}
function MessageRow({ message, app }: { message: Message; app: Prototype }) {
  const selected = app.selecting ? app.checked.includes(message.id) : app.detail?.id === message.id
  const party = app.box === "inbox" ? message.sender.name : partyNames(message.to)
  return <button type="button" data-message={message.id} aria-pressed={app.selecting ? selected : undefined} aria-current={!app.selecting && selected ? "true" : undefined} aria-label={`${party}，${message.subject}${message.unread ? "，未读" : ""}`} onClick={() => app.open(message)} className={cn("flex w-full gap-3 border-b border-border px-4 py-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", selected && "bg-selected")}>
    {app.selecting && <span className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-input" aria-hidden="true">{selected && <Check className="size-3" />}</span>}
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center justify-between gap-3">
        <span className={cn("flex min-w-0 items-center gap-2 text-sm", message.unread && "font-semibold")}>
          {message.unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          <span className="truncate">{party}</span>
          {message.sender.kind === "system" && <ShieldCheck className="size-3 shrink-0 text-muted-foreground" aria-label="系统发件人" />}
        </span>
        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={message.sentAt}>{dateLabel(message.sentAt)}</time>
      </span>
      <span className={cn("truncate text-sm", message.unread && "font-medium")}>{message.subject}</span>
      <span className="truncate text-xs leading-5 text-muted-foreground">{message.body.replaceAll("\n", " ")}</span>
      {app.box === "sent" && message.cc.length > 0 && <span className="truncate text-xs text-muted-foreground">抄送：{partyNames(message.cc)}</span>}
    </span>
  </button>
}
function MessageList({ app }: { app: Prototype }) {
  const showGlobal = !app.contact
  const idsInBox = app.messages.filter(item => item.box === app.box).map(item => item.id)
  const filtered = app.contact || app.query || app.unreadOnly
  return <section aria-label="信件列表" className={cn("min-h-0 min-w-0 flex-1 flex-col", app.detail ? "hidden @3xl/mail:flex" : "flex")}>
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Input type="search" placeholder="搜索主题或正文" aria-label="搜索主题或正文" value={app.query} onChange={event => app.search(event.target.value)} />
    </div>
    {app.contact && <div className="flex shrink-0 items-center gap-2 px-4 pt-3 text-sm" aria-label="当前人员筛选">
      <PartyIcon kind={app.contact.kind} /><span className="min-w-0 truncate font-medium" title={app.contact.name}>{app.contact.name}</span>
      {app.contact.kind === "organization" && <Badge variant="secondary">组织</Badge>}
      <Button size="icon-xs" variant="ghost" aria-label="解除人员筛选" onClick={() => app.chooseContact(null)}><X /></Button>
    </div>}
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2">
      <Button size="sm" variant="ghost" onClick={app.toggleSelecting}>{app.selecting ? "取消选择" : "选择"}</Button>
      {app.box === "inbox" && <Button size="sm" variant={app.unreadOnly ? "secondary" : "ghost"} aria-pressed={app.unreadOnly} onClick={app.toggleUnread}>只看未读</Button>}
      {app.selecting && <Button size="sm" variant="destructive" disabled={!app.checked.length} onClick={() => app.setDeleting(app.checked)}>删除选中{app.checked.length ? `（${app.checked.length}）` : ""}</Button>}
      {!app.selecting && showGlobal && app.box === "inbox" && <Button size="sm" variant="ghost" disabled={!app.totalUnread} onClick={app.markAllRead}>全部设已读</Button>}
      {!app.selecting && showGlobal && <Button size="sm" variant="ghost" className="ml-auto" disabled={!idsInBox.length} onClick={() => app.setDeleting(idsInBox)}>清空{app.boxLabel}</Button>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
      {app.list.map(message => <MessageRow key={message.id} message={message} app={app} />)}
      {!app.list.length && <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>{filtered ? "没有匹配的信件" : `${app.boxLabel}为空`}</EmptyTitle></EmptyHeader>{filtered && <EmptyContent><Button variant="outline" onClick={app.clearFilters}>查看全部</Button></EmptyContent>}</Empty>}
    </div>
  </section>
}
function Detail({ app }: { app: Prototype }) {
  const message = app.detail
  return <section aria-label="信件内容" className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-y-auto", message ? "flex" : "hidden @3xl/mail:flex")}>
    {message ? <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" className="@3xl/mail:hidden" onClick={app.clearSelection}><ArrowLeft />返回</Button>
        <div className="ml-auto flex items-center gap-1">
          {app.box === "inbox" && <Button variant="ghost" onClick={app.toggleRead}>{message.unread ? <MailOpen /> : <Mail />}{message.unread ? "设为已读" : "设为未读"}</Button>}
          <Button variant="ghost" aria-label="删除当前信件" onClick={() => app.setDeleting([message.id])}><Trash2 />删除</Button>
        </div>
      </div>
      <article className="mx-auto w-full max-w-3xl px-6 py-8 lg:px-8">
        <h1 className="break-words text-xl font-semibold leading-8">{message.subject}</h1>
        <dl className="mt-6 grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-start gap-3"><dt className="w-12 shrink-0 text-muted-foreground">发件人</dt><dd className="flex min-w-0 flex-wrap items-center gap-2"><span>{message.sender.name}</span>{message.sender.kind === "system" ? <Badge variant="secondary"><ShieldCheck />系统</Badge> : message.sender.identity && <span className="text-muted-foreground">{message.sender.identity}</span>}</dd></div>
          <div className="flex items-start gap-3"><dt className="w-12 shrink-0 text-muted-foreground">收件人</dt><dd className="min-w-0 break-words">{partyNames(message.to)}</dd></div>
          {message.cc.length > 0 && <div className="flex items-start gap-3"><dt className="w-12 shrink-0 text-muted-foreground">抄送</dt><dd className="min-w-0 break-words">{partyNames(message.cc)}</dd></div>}
          <div className="flex items-start gap-3"><dt className="w-12 shrink-0 text-muted-foreground">时间</dt><dd><time dateTime={message.sentAt}>{message.sentAt.replace("T", " ").slice(0, 16)}</time></dd></div>
        </dl>
        <div className="mt-8 whitespace-pre-wrap break-words border-t border-border pt-8 text-sm leading-7">{message.body}</div>
      </article>
    </> : <Empty className="h-full"><EmptyHeader><EmptyMedia variant="icon"><MailOpen /></EmptyMedia><EmptyTitle>选择一封信件</EmptyTitle></EmptyHeader></Empty>}
  </section>
}
function PrototypeApp() {
  const app = usePrototype()
  return <TooltipProvider delayDuration={400}>
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3"><Mail className="size-5 shrink-0" /><span className="font-semibold">站内信</span><Badge variant="secondary">交互原型</Badge><span className="hidden text-xs text-muted-foreground sm:inline">示例数据</span></div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" onClick={app.reset}><RotateCcw />重置示例</Button>
          <Button variant="ghost" size="icon" aria-label={app.dark ? "切换浅色" : "切换深色"} onClick={() => app.setDark(!app.dark)}>{app.dark ? <Sun /> : <Moon />}</Button>
        </div>
      </header>
      <div className="min-h-0 flex-1"><MailLayout navigation={<Navigation app={app} />} list={<MessageList app={app} />} detail={<Detail app={app} />} showDetail /></div>
      {app.notice && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background">{app.notice}</div>}
    </main>
    <AlertDialog open={app.deleting !== null} onOpenChange={open => { if (!open) app.setDeleting(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>删除 {app.deleting?.length ?? 0} 封信件？</AlertDialogTitle><AlertDialogDescription>只从当前信箱移除这些示例信件，可通过「重置示例」恢复。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={app.confirmDelete}>删除</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </TooltipProvider>
}

createRoot(document.getElementById("mail-prototype")!).render(<PrototypeApp />)
