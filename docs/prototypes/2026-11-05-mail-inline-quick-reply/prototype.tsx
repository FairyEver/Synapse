import { useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createRoot } from "react-dom/client"
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Cloud,
  Copy,
  Forward,
  Mail,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Sun,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { canQuickReplyToMail } from "@/lib/mail-reply"
import { MailLayout } from "@/modules/mail-internal/layout"
import { MailNavigation } from "@/modules/mail-internal/navigation"
import type { MailMessage } from "@/types/mail"
import { addressNames, fullTime, personEmail, personName, sentTime, viewer } from "./model"
import { usePrototype, type Prototype } from "./use-prototype"

function AppRail({ app }: { app: Prototype }) {
  const primary = [
    { label: "会话", icon: MessageCircle },
    { label: "云盘", icon: Cloud },
    { label: "动态", icon: Bell },
  ]
  return <aside aria-label="应用导航" className="hidden w-16 shrink-0 flex-col items-center border-r bg-sidebar py-3 md:flex">
    <Button variant="ghost" size="icon" aria-label="Synapse"><span className="text-sm font-semibold">S</span></Button>
    <nav className="mt-5 flex flex-col items-center gap-2">
      {primary.map(({ label, icon: Icon }) => <Button key={label} variant="ghost" size="icon" aria-label={label} onClick={() => app.setNotice(`${label}原型未展开`)}><Icon /></Button>)}
      <Button variant="ghost" size="icon" className="bg-selected hover:bg-selected" aria-label="站内信" aria-current="page"><Mail /></Button>
    </nav>
    <div className="mt-auto flex flex-col items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="通知" onClick={() => app.setNotice("当前没有新通知")}><Bell /></Button>
      <Button variant="ghost" size="icon" aria-label="设置" onClick={() => app.setNotice("站内信设置原型未展开")}><Settings /></Button>
      <Button variant="ghost" size="icon" aria-label={`当前账号 ${viewer.nickname}`} onClick={() => app.setNotice("账号菜单原型未展开")}><span className="text-sm font-semibold">李</span></Button>
    </div>
  </aside>
}

function TopBar({ app }: { app: Prototype }) {
  return <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
    <Button variant="ghost" className="min-w-0 justify-start text-sm font-medium" onClick={() => app.setNotice("账号切换原型未展开")}>
      <span className="truncate">{personEmail(viewer)}</span><ChevronDown className="text-muted-foreground" />
    </Button>
    <div className="flex shrink-0 items-center gap-1">
      <Badge variant="secondary">交互原型</Badge>
      <Button variant="ghost" size="icon" aria-label={app.dark ? "切换浅色" : "切换深色"} onClick={() => app.setDark(!app.dark)}>{app.dark ? <Sun /> : <Moon />}</Button>
      <Button variant="ghost" size="icon" aria-label="刷新" onClick={() => app.setNotice("已刷新")}><RefreshCw /></Button>
      <Button onClick={() => app.setNotice("写信入口保持不变")}><Pencil />写邮件</Button>
    </div>
  </header>
}

function ListPane({ app }: { app: Prototype }) {
  return <section aria-label={app.box === "inbox" ? "收件箱" : "已发送"} className={cn("min-h-0 min-w-0 flex-1 flex-col", app.selectedId ? "hidden group-data-[wide=true]/mail:flex" : "flex")}>
    <form className="flex h-10 shrink-0 items-center border-b px-2 focus-within:border-foreground focus-within:bg-muted" onSubmit={(event) => event.preventDefault()}>
      <Input type="search" aria-label="搜索信件" value={app.query} onChange={(event) => app.setQuery(event.target.value)} placeholder="搜索主题或正文" className="h-full flex-1 rounded-none border-0 px-2 focus-visible:ring-0 dark:bg-transparent" />
      <Button type="submit" variant="ghost" size="icon" className="size-10" aria-label="搜索"><Search /></Button>
    </form>
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b p-2">
      <Button type="button" size="sm" variant="ghost" onClick={() => app.setNotice("批量选择原型未展开")}>选择</Button>
      {app.box === "inbox" && <Button type="button" size="sm" variant={app.unreadOnly ? "secondary" : "ghost"} aria-pressed={app.unreadOnly} onClick={() => app.setUnreadOnly(!app.unreadOnly)}>只看未读</Button>}
      {app.box === "inbox" && !app.contactKey && <Button type="button" size="sm" variant="ghost" disabled={!app.totalUnread} onClick={app.markAllRead}>全部设已读</Button>}
    </div>
    <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full">
      {app.list.map((message) => <MessageRow key={message.messageId} message={message} app={app} />)}
      {!app.list.length && <div className="p-6 text-sm text-muted-foreground">没有匹配的信件</div>}
    </ScrollArea>
  </section>
}

function MessageRow({ message, app }: { message: MailMessage; app: Prototype }) {
  const selected = app.selectedId === message.messageId
  const people = app.box === "inbox" ? personName(message.sender) : addressNames(message.toRecipients)
  return <button
    type="button"
    aria-current={selected ? "true" : undefined}
    aria-label={`${people}，${message.subject}${message.readAt ? "" : "，未读"}`}
    className={cn("block w-full border-b px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring", selected ? "bg-selected" : "hover:bg-accent")}
    onClick={() => app.openMessage(message.messageId)}
  >
    <span className="flex items-center justify-between gap-2">
      <span className={cn("flex min-w-0 flex-1 items-center gap-2 text-sm", !message.readAt && "font-semibold")}>
        {app.box === "inbox" && !message.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
        <span className="min-w-0 truncate">{people}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{sentTime(message.sentAt)}</span>
    </span>
    <span className={cn("mt-1 block truncate text-sm", !message.readAt && "font-medium")}>{message.relationKind === "reply" ? "回复 · " : message.relationKind === "forward" ? "转发 · " : ""}{message.subject}</span>
    <span className="mt-1 block truncate text-xs text-muted-foreground">{message.snippet}</span>
  </button>
}

function InlineQuickReply({ message, onSend }: { message: MailMessage; onSend: (message: MailMessage, body: string) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function send() {
    const value = body.trim()
    if (!value || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError("")
    try {
      await onSend(message, value)
      setBody("")
      window.requestAnimationFrame(() => inputRef.current?.focus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败，请重试。")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  function keyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return <form className="mt-5 flex items-start gap-2" aria-label={`快速回复 ${personName(message.sender)}`} onSubmit={submit}>
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        name="quick-reply-body"
        value={body}
        placeholder="快速回复"
        aria-label={`快速回复 ${personName(message.sender)}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "quick-reply-error" : undefined}
        autoComplete="off"
        enterKeyHint="send"
        disabled={busy}
        onChange={(event) => {
          setBody(event.target.value)
          if (error) setError("")
        }}
        onKeyDown={keyDown}
      />
      {error && <p id="quick-reply-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
    <Button type="submit" className="min-w-20" disabled={busy || !body.trim()} aria-busy={busy}>
      {busy ? "发送中…" : <><Send />发送</>}
    </Button>
  </form>
}

function DetailToolbar({ app, message, onLegacyReply }: { app: Prototype; message: MailMessage; onLegacyReply(): void }) {
  return <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
    <Button variant="ghost" size="icon" className="group-data-[wide=true]/mail:hidden" aria-label="返回列表" onClick={() => app.openMessage("")}><ArrowLeft /></Button>
    <Button variant="ghost" disabled={!canQuickReplyToMail(message)} onClick={() => app.setNotice("完整回复入口保持不变")}><Reply />回复</Button>
    <Button variant="ghost" onClick={() => app.setNotice("转发入口保持不变")}><Forward />转发</Button>
    <Button variant="ghost" onClick={() => app.setNotice("ID 已复制")}><Copy />复制ID</Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" className="ml-auto"><MoreHorizontal />更多</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canQuickReplyToMail(message) && <DropdownMenuItem onSelect={onLegacyReply}>快速回复</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => app.setNotice("回复全部入口保持不变")}>回复全部</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => app.setNotice("正文已复制")}>复制正文</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}

function DetailPane({ app, onLegacyReply }: { app: Prototype; onLegacyReply(message: MailMessage): void }) {
  const message = app.detail
  if (!message) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一封信件</div>
  return <section aria-label="信件内容" className="flex h-full min-h-0 min-w-0 flex-col">
    <DetailToolbar app={app} message={message} onLegacyReply={() => onLegacyReply(message)} />
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-3xl wrap-anywhere px-6 py-7">
        <h1 className="text-xl font-semibold leading-8 text-balance">{message.subject}</h1>
        {message.relationKind && <p className="mt-2 text-xs text-muted-foreground">{message.relationKind === "reply" ? "回复" : "转发"}</p>}
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-right text-muted-foreground">发件人</dt>
          <dd className="min-w-0"><span className="font-medium">{personName(message.sender)}</span>{message.sender.userId !== viewer.userId && <span className="ml-1 text-xs text-muted-foreground">&lt;{personEmail(message.sender)}&gt;</span>}</dd>
          <dt className="text-right text-muted-foreground">收件人</dt>
          <dd className="min-w-0">{addressNames(message.toRecipients)}</dd>
          {message.ccRecipients.length > 0 && <><dt className="text-right text-muted-foreground">抄送</dt><dd className="min-w-0">{addressNames(message.ccRecipients)}</dd></>}
          <dt className="text-right text-muted-foreground">时间</dt>
          <dd><time dateTime={message.sentAt}>{fullTime(message.sentAt)}</time></dd>
        </dl>
        {canQuickReplyToMail(message) && <InlineQuickReply key={message.messageId} message={message} onSend={app.reply} />}
        <div className="mt-7 whitespace-pre-wrap border-t pt-7 text-sm leading-7">{message.body}</div>
      </article>
    </div>
  </section>
}

function LegacyQuickReplyDialog({ source, onClose, onSend }: { source: MailMessage | null; onClose(): void; onSend(message: MailMessage, body: string): Promise<void> }) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  function close() {
    if (busy) return
    setBody("")
    setError("")
    onClose()
  }

  async function send() {
    if (!source || busy || !body.trim()) return
    setBusy(true)
    setError("")
    try {
      await onSend(source, body.trim())
      setBody("")
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败，请重试。")
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open={source !== null} onOpenChange={(open) => {
    if (!open) close()
  }}>
    <DialogContent aria-describedby={undefined} className="sm:max-w-xl">
      <DialogHeader><DialogTitle>快速回复</DialogTitle></DialogHeader>
      <Textarea aria-label="回复内容" rows={8} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button>
        <Button type="button" disabled={busy || !body.trim()} onClick={() => void send()}>{busy ? "发送中…" : "发送"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function PrototypeApp() {
  const app = usePrototype()
  const [legacyReply, setLegacyReply] = useState<MailMessage | null>(null)
  return <main className="flex h-dvh min-h-0 overflow-hidden bg-background font-sans text-foreground antialiased">
    <AppRail app={app} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TopBar app={app} />
      <div className="min-h-0 flex-1">
        <MailLayout
          navigation={<MailNavigation
            box={app.box}
            contacts={app.contacts}
            ready
            error={null}
            unread={app.totalUnread}
            selected={app.contacts.find((contact) => contact.key === app.contactKey) ?? null}
            onBoxChange={app.changeBox}
            onSelect={(contact) => app.chooseContact(contact?.key ?? null)}
            onRetry={() => app.setNotice("已刷新人员")}
          />}
          list={<ListPane app={app} />}
          detail={<DetailPane app={app} onLegacyReply={setLegacyReply} />}
          showDetail={Boolean(app.selectedId)}
        />
      </div>
    </div>
    {app.notice && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background">{app.notice}</div>}
    <LegacyQuickReplyDialog source={legacyReply} onClose={() => setLegacyReply(null)} onSend={app.reply} />
  </main>
}

createRoot(document.getElementById("mail-inline-quick-reply")!).render(<PrototypeApp />)
