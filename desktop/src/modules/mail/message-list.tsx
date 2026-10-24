import { useState, useEffect } from "react"
import { Star, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { MailMessageMenu } from "./message-menu"
import { MailListToolbar, type BatchAction, type MailSearchControls } from "./list-toolbar"
import { cn } from "@/lib/utils"
import type { MailSummary, Draft, Folder } from "../../../app-capabilities/mail/shared/types"
export function MailList({ items, drafts, draftView, selected, loading, more, onSelect, onDraft, onMore, onBatch, folders, onMove, busy, ...search }: MailSearchControls & { busy?: boolean; items: MailSummary[]; drafts: Omit<Draft, "html" | "text">[]; draftView?: boolean; selected?: string; loading: boolean; more: boolean; onSelect(id: string): void; onDraft(id: string): void; onMore(): void; folders: Folder[]; onMove(ids: string[], folderId: string): void; onBatch(action: BatchAction, ids: string[]): void }) {
  const [checked, setChecked] = useState<string[]>([])
  const rows = draftView ? drafts : items
  useEffect(() => { setChecked(current => current.filter(id => rows.some(item => item.id === id))) }, [rows])
  const trashFolders = new Set(folders.filter(folder => folder.role === "trash").map(folder => folder.id))
  const canPermanentlyDelete = checked.length > 0 && checked.every(id => items.some(item => item.id === id && trashFolders.has(item.locator.folderId)))
  const toggle = (id: string, value: boolean) => setChecked(current => value ? current.length < 100 ? [...current, id] : current : current.filter(item => item !== id))
  return <section aria-label="邮件列表" className="flex h-full min-h-0 flex-col bg-background">
    <MailListToolbar {...(draftView ? {} : search)} draftView={draftView} count={checked.length} all={rows.length > 0 && rows.slice(0, 100).every(item => checked.includes(item.id))} disabled={!rows.length} busy={busy} onToggle={value => setChecked(value ? rows.slice(0, 100).map(item => item.id) : [])} onBatch={action => onBatch(action, checked)} onMove={id => onMove(checked, id)} folders={folders} canPermanentlyDelete={canPermanentlyDelete} />
    <div className="min-h-0 flex-1 overflow-auto">
      {loading && !items.length && !drafts.length ? <div className="space-y-3 p-4" aria-label="加载中">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-16 w-full" />)}</div> : draftView ? drafts.map(draft => <MailMessageMenu key={draft.id} id={draft.id} draftView folders={folders} busy={busy} onBatch={onBatch} onMove={onMove}><div className="flex items-start border-b px-3 hover:bg-accent">
        <Checkbox className="mt-5" data-track="mail.draft.select" aria-label={`选择 ${draft.subject || "无主题"}`} checked={checked.includes(draft.id)} disabled={busy || checked.length >= 100 && !checked.includes(draft.id)} onCheckedChange={value => toggle(draft.id, value === true)} />
        <button type="button" data-track="mail.draft.open" className="min-w-0 flex-1 px-3 py-4 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onDraft(draft.id)}><span className="flex min-w-0 flex-col gap-1"><span className="truncate">{draft.subject || "（无主题）"}</span><span className="text-xs text-muted-foreground">{draft.state === "consumed" ? "已发送（只读）" : draft.state === "conflict" ? "草稿冲突" : draft.syncState === "synced" ? "已同步" : draft.localSaved ? "已存本机" : "远端草稿"}</span></span></button>
      </div></MailMessageMenu>) : items.map(item => <MailMessageMenu key={item.id} id={item.id} folders={folders} busy={busy} canPermanentlyDelete={trashFolders.has(item.locator.folderId)} onBatch={onBatch} onMove={onMove}><div className={cn("flex items-start border-b px-3", selected === item.id ? "bg-selected" : "hover:bg-accent")}>
        <Checkbox className="mt-5" data-track="mail.message.select" aria-label={`选择 ${item.subject || "无主题"}`} checked={checked.includes(item.id)} disabled={checked.length >= 100 && !checked.includes(item.id)} onCheckedChange={value => toggle(item.id, value === true)} />
        <button type="button" className="min-w-0 flex-1 px-3 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(item.id)} data-track="mail.message.open"><span className="flex w-full min-w-0 flex-col gap-1">
          <span className={cn("flex items-center justify-between gap-2", !item.read && "font-semibold")}><span className="truncate">{item.from.map(from => from.name || from.address).join(", ") || "未知发件人"}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{item.date ? new Date(item.date).toLocaleDateString() : ""}</span></span>
          <span className={cn("flex items-center gap-1", !item.read && "font-semibold")}>{item.star && <Star className="size-3 shrink-0" aria-label="已加星标" />}<span className="truncate">{item.subject || "（无主题）"}</span>{item.attachmentCount > 0 && <Paperclip className="size-3 shrink-0" aria-label="含附件" />}</span>
          {item.snippet && <span className="truncate text-xs text-muted-foreground">{item.snippet}</span>}
        </span></button>
      </div></MailMessageMenu>)}
      {!loading && (draftView ? !drafts.length : !items.length) && <p className="p-6 text-sm text-muted-foreground">没有邮件</p>}
      {more && <div className="p-3"><Button variant="outline" className="w-full" disabled={loading} onClick={onMore}>加载更多</Button></div>}
    </div>
  </section>
}
