import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { MailNavigation, folderName } from "./navigation"
import { MailList } from "./message-list"
import { MailDetail } from "./message-detail"
import { useMailBody } from "./use-mail-body"
import { mailApi, mailError, openMailLink } from "./api"
import type { MailViewModel } from "./use-mail"
export type ComposeIntent = { draftId: string } | { accountId: string; sourceMessageId?: string; mode?: "reply" | "reply_all" | "forward" }
export function MailLayout({ mail, onSettings, onCompose }: { mail: MailViewModel; onSettings(): void; onCompose(intent: ComposeIntent): void }) {
  const [query, setQuery] = useState(""), [fields, setFields] = useState<"metadata" | "body">("metadata")
  const [permanent, setPermanent] = useState<string[] | null>(null), [busy, setBusy] = useState(false)
  const body = useMailBody(mail.detail, mail.owner)
  const coverageLabel = mail.coverage?.reason === "body_truncated" ? "部分正文未完整检索" : mail.canContinue ? "部分邮件尚未检索" : !mail.coverage?.metadataComplete ? "历史邮件索引中" : "范围：服务器当前可见历史"
  const performBatch = async (action: Parameters<typeof mail.mutate>[0], ids: string[], targetFolderId?: string) => {
    setBusy(true)
    try { const result = await mail.mutate(action, ids, targetFolderId); const succeeded = result.items.filter(item => item.status === "succeeded").length, unknown = result.items.filter(item => item.status === "unknown").length; toast(`${succeeded} 封完成${unknown ? `，${unknown} 封结果待核验` : ""}${result.items.length - succeeded - unknown ? `，${result.items.length - succeeded - unknown} 封失败` : ""}`); setPermanent(null) }
    catch (cause) { toast.error(mailError(cause)) } finally { setBusy(false) }
  }
  const onBatch = (action: Parameters<typeof mail.mutate>[0], ids: string[]) => { if (action === "permanent") setPermanent(ids); else void performBatch(action, ids) }
  const download = async (assetId: string) => { try { await mailApi().saveAttachment({ assetId }) } catch (cause) { toast.error(mailError(cause)) } }
  const openLink = async (url: string) => { try { await openMailLink(url) } catch (cause) { toast.error(mailError(cause)) } }
  const copy = async () => { if (mail.detail) { try { await navigator.clipboard.writeText(`synapse://mail/${mail.detail.id}`); toast("链接已复制") } catch { toast.error("复制失败") } } }
  return <div className="flex h-full min-h-0 flex-col">
    {(mail.error || body.error) && <div role="alert" className="flex items-center justify-between gap-3 border-b p-3 text-sm text-destructive"><span>{mail.error ?? body.error}</span><Button variant="ghost" onClick={() => void mail.refresh()}>重试</Button></div>}
    {!mail.authenticated ? <p className="p-6 text-sm text-muted-foreground">请先登录 Synapse</p> : !mail.accounts.length ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><p className="text-sm text-muted-foreground">尚未添加邮箱</p><Button onClick={onSettings}>添加邮箱</Button></div> : <div className="flex min-h-0 flex-1">
      <aside className="hidden w-52 shrink-0 md:block"><MailNavigation {...mail} onAccount={mail.selectAccount} onView={mail.selectView} onSettings={onSettings} /></aside>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col border-r lg:w-80 lg:flex-none", mail.detail && "hidden lg:flex")}>
        <div className="space-y-2 border-b p-3">
          <div className="flex gap-2 md:hidden"><NativeSelect aria-label="邮箱账号" value={mail.accountId ?? ""} onChange={event => mail.selectAccount(event.target.value)}>{mail.accounts.map(account => <NativeSelectOption value={account.id} key={account.id}>{account.name}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="文件夹" value={mail.view.drafts ? "drafts" : mail.view.starredOnly ? "starred" : mail.view.folderId ?? "all"} onChange={event => { const value = event.target.value; mail.selectView(value === "drafts" ? { drafts: true } : value === "starred" ? { starredOnly: true } : value === "all" ? {} : { folderId: value }) }}><NativeSelectOption value="all">全部邮件</NativeSelectOption><NativeSelectOption value="starred">星标邮件</NativeSelectOption><NativeSelectOption value="drafts">草稿箱</NativeSelectOption>{mail.folders.filter(folder => folder.selectable && folder.role !== "drafts").map(folder => <NativeSelectOption key={folder.id} value={folder.id}>{folderName(folder)}</NativeSelectOption>)}</NativeSelect></div>
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void mail.search(query, fields) }}><Input aria-label="搜索邮件" placeholder="搜索邮件" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="outline" type="submit" disabled={mail.loading}>搜索</Button></form>
          <NativeSelect size="sm" aria-label="搜索范围" value={fields} onChange={event => setFields(event.target.value as typeof fields)}><NativeSelectOption value="metadata">发件人、收件人和主题</NativeSelectOption><NativeSelectOption value="body">含正文</NativeSelectOption></NativeSelect>
          {mail.coverage && (!mail.coverage.metadataComplete || mail.coverage.serverHistoryComplete !== true) && <div role="status" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{coverageLabel}</span>{mail.canContinue && <Button variant="ghost" size="xs" onClick={() => void mail.continueSearch().catch(cause => toast.error(mailError(cause)))}>继续检索</Button>}</div>}
        </div>
        <div className="min-h-0 flex-1"><MailList items={mail.items} drafts={mail.drafts} draftView={mail.view.drafts} selected={mail.detail?.id} loading={mail.loading} more={!!mail.cursor} onSelect={id => void mail.selectMessage(id)} onDraft={draftId => onCompose({ draftId })} onMore={() => void mail.loadMore()} onBatch={onBatch} folders={mail.folders} onMove={(ids, target) => void performBatch("move", ids, target)} /></div>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1", !mail.detail && "hidden lg:block")}>
        {mail.detail ? <MailDetail detail={mail.detail} {...body} onBack={mail.clearDetail} onResource={urls => void body.loadRemote(urls)} onDownload={id => void download(id)} onLink={url => void openLink(url)} onReply={mode => onCompose({ accountId: mail.detail!.accountId, sourceMessageId: mail.detail!.id, mode })} onCopy={() => void copy()} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一封邮件</div>}
      </div>
    </div>}
    <AlertDialog open={!!permanent} onOpenChange={open => { if (!open && !busy) setPermanent(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>永久删除 {permanent?.length} 封邮件？</AlertDialogTitle><AlertDialogDescription>只能删除回收站中的邮件，删除后无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void performBatch("permanent", permanent!)}>永久删除</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
