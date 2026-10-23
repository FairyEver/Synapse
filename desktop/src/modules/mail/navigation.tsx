import { Inbox, Send, FilePen, Trash2, Archive, ShieldAlert, Folder as FolderIcon, Star, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import type { AccountSummary, Folder } from "../../../app-capabilities/mail/shared/types"
import type { MailView } from "./use-mail"
const labels: Record<string, string> = { inbox: "收件箱", sent: "已发送", drafts: "草稿箱", trash: "回收站", junk: "垃圾邮件", archive: "归档" }
const icons = { inbox: Inbox, sent: Send, drafts: FilePen, trash: Trash2, junk: ShieldAlert, archive: Archive, none: FolderIcon }
export function folderName(folder: Folder) { return labels[folder.role] ?? folder.name }
export function MailNavigation({ accounts, accountId, folders, view, onAccount, onView, onSettings }: { accounts: AccountSummary[]; accountId: string | null; folders: Folder[]; view: MailView; onAccount(id: string): void; onView(view: MailView): void; onSettings(): void }) {
  return <nav aria-label="邮箱导航" className="flex h-full min-h-0 flex-col gap-3 border-r bg-background p-3">
    <NativeSelect aria-label="邮箱账号" className="w-full" value={accountId ?? ""} onChange={event => onAccount(event.target.value)} data-track="mail.account.select">
      {!accounts.length && <NativeSelectOption value="">选择邮箱</NativeSelectOption>}
      {accounts.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}
    </NativeSelect>
    <div className="min-h-0 flex-1 space-y-1 overflow-auto">
      <Button variant="ghost" className={cn("w-full justify-start", !view.folderId && !view.starredOnly && !view.drafts && "bg-selected")} onClick={() => onView({})} data-track="mail.folder.all"><Inbox />全部邮件</Button>
      <Button variant="ghost" className={cn("w-full justify-start", view.starredOnly && "bg-selected")} onClick={() => onView({ starredOnly: true })} data-track="mail.folder.starred"><Star />星标邮件</Button>
      <Button variant="ghost" className={cn("w-full justify-start", view.drafts && "bg-selected")} onClick={() => onView({ drafts: true })} data-track="mail.folder.drafts"><FilePen />草稿箱</Button>
      {folders.filter(folder => folder.selectable && folder.role !== "drafts").map(folder => { const Icon = icons[folder.role]; return <Button key={folder.id} variant="ghost" className={cn("w-full justify-start", view.folderId === folder.id && "bg-selected")} onClick={() => onView({ folderId: folder.id })} data-track="mail.folder.select"><Icon /><span className="truncate">{folderName(folder)}</span></Button> })}
    </div>
    <Button variant="ghost" className="w-full justify-start" onClick={onSettings} data-track="mail.settings"><Settings />邮箱设置</Button>
  </nav>
}
