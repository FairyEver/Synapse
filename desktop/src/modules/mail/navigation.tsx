import { Inbox, Send, FilePen, Trash2, Archive, ShieldAlert, Folder as FolderIcon, Star, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import type { AccountSummary, Folder } from "../../../app-capabilities/mail/shared/types"
import type { MailView } from "./use-mail"
const labels: Record<string, string> = { inbox: "收件箱", sent: "已发送", drafts: "草稿箱", trash: "回收站", junk: "垃圾邮件", archive: "归档" }
const icons = { inbox: Inbox, sent: Send, drafts: FilePen, trash: Trash2, junk: ShieldAlert, archive: Archive, none: FolderIcon }
const folderOrder: Record<Folder["role"], number> = { inbox: 0, drafts: 1, sent: 2, trash: 3, junk: 4, none: 7 }
type MailNavigationItem = { value: string; label: string; icon: typeof Inbox; view: MailView; order: number }
export function folderName(folder: Folder) { return labels[folder.role] ?? folder.name }
export function mailNavigationItems(folders: Folder[]): MailNavigationItem[] {
  const items: MailNavigationItem[] = folders.filter(folder => folder.selectable && folder.role !== "drafts").map(folder => ({ value: folder.id, label: folderName(folder), icon: icons[folder.role], view: { folderId: folder.id }, order: folderOrder[folder.role] }))
  items.push(
    { value: "drafts", label: "草稿箱", icon: FilePen, view: { drafts: true }, order: 1 },
    { value: "all", label: "全部邮件", icon: Inbox, view: {}, order: 5 },
    { value: "starred", label: "星标邮件", icon: Star, view: { starredOnly: true }, order: 6 },
  )
  return items.sort((a, b) => a.order - b.order)
}
export function MailNavigation({ accounts, accountId, folders, view, onAccount, onView, onSettings }: { accounts: AccountSummary[]; accountId: string | null; folders: Folder[]; view: MailView; onAccount(id: string): void; onView(view: MailView): void; onSettings(): void }) {
  const selected = view.drafts ? "drafts" : view.starredOnly ? "starred" : view.folderId ?? "all"
  return <nav aria-label="邮箱导航" className="flex h-full min-h-0 flex-col gap-3 border-r bg-background p-3">
    <NativeSelect aria-label="邮箱账号" className="w-full" value={accountId ?? ""} onChange={event => onAccount(event.target.value)} data-track="mail.account.select">
      {!accounts.length && <NativeSelectOption value="">选择邮箱</NativeSelectOption>}
      {accounts.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}
    </NativeSelect>
    <div className="min-h-0 flex-1 space-y-1 overflow-auto">
      {mailNavigationItems(folders).map(item => { const Icon = item.icon; return <Button key={item.value} variant="ghost" className={cn("w-full justify-start", selected === item.value && "bg-selected hover:bg-selected")} onClick={() => onView(item.view)} data-track={item.view.folderId ? "mail.folder.select" : `mail.folder.${item.value}`}><Icon /><span className="truncate">{item.label}</span></Button> })}
    </div>
    <Button variant="ghost" className="w-full justify-start" onClick={onSettings} data-track="mail.settings"><Settings />邮箱设置</Button>
  </nav>
}
