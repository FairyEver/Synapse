import { useMemo, useState } from "react"
import { Building2, ChevronDown, Inbox, Send, ShieldCheck, UserRound, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { MailContact } from "@/types/mail"
import type { MailBox } from "./use-mail"

type Props = {
  box: MailBox; contacts: MailContact[]; ready: boolean; error: string | null; unread: number
  selected: MailContact | null; onBoxChange: (box: MailBox) => void
  onSelect: (contact: MailContact | null) => void; onRetry: () => void
}

function countLabel(value: number) { return value > 99 ? "99+" : String(value) }
function contactIdentity(contact: MailContact) {
  if (contact.kind === "platform") return null
  return contact.kind === "organization" ? contact.teamName || contact.key.slice("organization:".length)
    : contact.handle ? `@${contact.handle}` : contact.key.slice("user:".length)
}

function ContactList({ contacts, ready, error, box, selected, onSelect, onRetry, query, onQueryChange }: Props & { query: string; onQueryChange: (value: string) => void }) {
  const label = box === "inbox" ? "发件人" : "收件人"
  const rows = useMemo(() => {
    const names = new Map<string, number>()
    const identities = new Map<string, number>()
    contacts.forEach(contact => {
      names.set(contact.name, (names.get(contact.name) ?? 0) + 1)
      const identityKey = JSON.stringify([contact.name, contactIdentity(contact)])
      identities.set(identityKey, (identities.get(identityKey) ?? 0) + 1)
    })
    const needle = query.trim().toLocaleLowerCase()
    return contacts.filter(contact => `${contact.name} ${contact.handle ?? ""} ${contact.teamName ?? ""} ${contact.key}`.toLocaleLowerCase().includes(needle)).map(contact => {
      let identity = names.get(contact.name)! > 1 ? contactIdentity(contact) : null
      if (identity && identities.get(JSON.stringify([contact.name, identity]))! > 1) identity += ` · ${contact.key.split(":")[1]}`
      return { contact, identity }
    })
  }, [contacts, query])
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="shrink-0 group-data-[wide=true]/mail:px-3"><Input type="search" value={query} aria-label={`查找${label}`} placeholder={`查找${label}`} onChange={event => onQueryChange(event.target.value)} /></div>
    <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="[&>div]:!block">
      <div className="space-y-1 group-data-[wide=true]/mail:px-3">
        <Button variant="ghost" className={cn("w-full justify-start", !selected && "bg-selected hover:bg-selected dark:hover:bg-selected")} aria-pressed={!selected} onClick={() => onSelect(null)}><UsersRound />全部{label}</Button>
        {rows.map(({ contact, identity }) => {
          const Icon = contact.kind === "platform" ? ShieldCheck : contact.kind === "organization" ? Building2 : UserRound
          const name = `${contact.name}${identity ? ` ${identity}` : ""}`
          return <Button key={contact.key} variant="ghost" className={cn("w-full justify-start", selected?.key === contact.key && "bg-selected hover:bg-selected dark:hover:bg-selected")} aria-pressed={selected?.key === contact.key} aria-label={`${name}${box === "inbox" && contact.unread ? `，${contact.unread} 封未读` : ""}`} onClick={() => onSelect(contact)}>
              <Icon className="text-muted-foreground" />
              <span className={cn("min-w-0 flex-1 truncate text-left", box === "inbox" && contact.unread > 0 && "font-semibold")}>{contact.name}{identity && <span className="ml-1 text-xs font-normal text-muted-foreground group-hover/button:text-foreground group-aria-pressed/button:text-foreground">{identity}</span>}</span>
              {contact.kind === "platform" && <span className="text-xs font-normal text-muted-foreground group-hover/button:text-foreground group-aria-pressed/button:text-foreground">系统</span>}
              {box === "inbox" && contact.unread > 0 && <span className="min-w-4 shrink-0 text-right text-xs tabular-nums" aria-hidden="true">{countLabel(contact.unread)}</span>}
          </Button>
        })}
        {!ready && <div role="status" aria-label="加载人员中" className="space-y-2 py-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
        {error && <div className="space-y-2 px-2 py-3"><p role="alert" className="text-sm text-destructive">人员加载失败</p><Button variant="outline" onClick={onRetry}>重试</Button></div>}
        {ready && !error && !rows.length && <p className="px-2.5 py-3 text-sm text-muted-foreground">{query ? "没有匹配的结果" : `暂无${label}`}</p>}
      </div>
    </ScrollArea>
  </div>
}

export function MailNavigation(props: Props) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const label = props.box === "inbox" ? "发件人" : "收件人"
  function select(contact: MailContact | null) { props.onSelect(contact); setOpen(false) }
  const content = <ContactList {...props} onSelect={select} query={query} onQueryChange={setQuery} />
  return <aside className="flex shrink-0 flex-col border-b bg-sidebar p-2 group-data-[wide=true]/mail:h-full group-data-[wide=true]/mail:min-h-0 group-data-[wide=true]/mail:border-b-0 group-data-[wide=true]/mail:px-0 group-data-[wide=true]/mail:py-3">
    <nav aria-label="信箱" className="flex shrink-0 gap-1 group-data-[wide=true]/mail:mx-3 group-data-[wide=true]/mail:flex-col">
      <Button variant="ghost" aria-current={props.box === "inbox" ? "page" : undefined} className={cn("min-w-0 flex-1 justify-start group-data-[wide=true]/mail:flex-none", props.box === "inbox" && "bg-selected hover:bg-selected dark:hover:bg-selected")} onClick={() => props.onBoxChange("inbox")}><Inbox />收件箱{props.unread > 0 && <span className="ml-auto text-xs tabular-nums" aria-label={`${props.unread} 封未读`}>{countLabel(props.unread)}</span>}</Button>
      <Button variant="ghost" aria-current={props.box === "sent" ? "page" : undefined} className={cn("min-w-0 flex-1 justify-start group-data-[wide=true]/mail:flex-none", props.box === "sent" && "bg-selected hover:bg-selected dark:hover:bg-selected")} onClick={() => props.onBoxChange("sent")}><Send />已发送</Button>
    </nav>
    <section aria-label={label} className="mt-7 hidden min-h-0 flex-1 flex-col gap-3 group-data-[wide=true]/mail:flex"><h2 className="mx-3 px-2.5 text-xs font-medium text-muted-foreground">{label}</h2>{content}</section>
    <div className="mt-3 group-data-[wide=true]/mail:hidden"><Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" className="w-full justify-between" aria-label={`选择${label}：${props.selected?.name ?? `全部${label}`}`}><span className="truncate">{props.selected?.name ?? `全部${label}`}</span><ChevronDown /></Button></PopoverTrigger>
      <PopoverContent align="start" className="max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width)">
        <div className="flex min-h-0 max-h-96 flex-col">{content}</div>
      </PopoverContent>
    </Popover></div>
  </aside>
}
