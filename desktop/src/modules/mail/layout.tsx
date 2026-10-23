import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { MailNavigation, folderName } from "./navigation"
import { MailList } from "./message-list"
import { MailDetail } from "./message-detail"
import { useMailBody } from "./use-mail-body"
import { mailApi, mailError, openMailLink } from "./api"
import type { MailViewModel } from "./use-mail"
import type { ComposeIntent } from "../../../app-capabilities/mail/shared/private-schema"
export type { ComposeIntent } from "../../../app-capabilities/mail/shared/private-schema"
export function MailLayout({ mail, onSettings, onCompose }: { mail: MailViewModel; onSettings(): void; onCompose(intent: ComposeIntent): void }) {
  const [confirmation, setConfirmation] = useState<{ ids: string[]; drafts: boolean } | null>(null), [busy, setBusy] = useState(false)
  const [draftRemaining, setDraftRemaining] = useState(0)
  const body = useMailBody(mail.detail, mail.owner, mail.clearDetail)
  const performBatch = async (action: Parameters<typeof mail.mutate>[0], ids: string[], targetFolderId?: string) => {
    setBusy(true)
    try { const result = await mail.mutate(action, ids, targetFolderId); const succeeded = result.items.filter(item => item.status === "succeeded").length, unknown = result.items.filter(item => item.status === "unknown").length; toast(`${succeeded} 封完成${unknown ? `，${unknown} 封结果待核验` : ""}${result.items.length - succeeded - unknown ? `，${result.items.length - succeeded - unknown} 封失败` : ""}`); setConfirmation(null) }
    catch (cause) { toast.error(mailError(cause)) } finally { setBusy(false) }
  }
  const performDraftDelete = async (ids: string[]) => {
    setDraftRemaining(ids.length)
    setBusy(true)
    try {
      const result = await mail.deleteDrafts(ids, setDraftRemaining), failed = result.items.filter(item => item.status === "failed")
      const message = `已删除 ${result.items.length - failed.length} 封草稿`
      if (failed.length) toast.error(`${message}，${failed.length} 封失败：${failed[0].error}`)
      else toast(message)
      setConfirmation(null)
    } catch (cause) { toast.error(mailError(cause)) } finally { setBusy(false) }
  }
  const onBatch = (action: Parameters<typeof mail.mutate>[0], ids: string[]) => { if (mail.view.drafts && action === "delete") setConfirmation({ ids, drafts: true }); else if (action === "permanent") setConfirmation({ ids, drafts: false }); else void performBatch(action, ids) }
  const download = async (assetId: string) => { try { await mailApi().saveAttachment({ assetId }) } catch (cause) { toast.error(mailError(cause)) } }
  const openLink = async (url: string) => { try { await openMailLink(url) } catch (cause) { toast.error(mailError(cause)) } }
  const copy = async (target: "id" | "body") => {
    if (!mail.detail) return
    const text = target === "id" ? mail.detail.id : body.body?.complete ? body.body.text : undefined
    if (text === undefined) return
    try { await navigator.clipboard.writeText(text); toast(target === "id" ? "ID 已复制" : "正文已复制") } catch { toast.error("复制失败") }
  }
  const deletingDrafts = busy && confirmation?.drafts
  const confirmationTitle = deletingDrafts ? "正在删除草稿" : `${confirmation?.drafts ? "删除" : "永久删除"} ${confirmation?.ids.length ?? 0} 封${confirmation?.drafts ? "草稿" : "邮件"}？`
  const confirmationDescription = deletingDrafts ? `剩余 ${draftRemaining} 封${draftRemaining === 0 ? "，正在刷新列表。" : ""}` : confirmation?.drafts ? "将删除所选草稿及其已同步副本，删除后无法恢复。" : "只能删除回收站中的邮件，删除后无法恢复。"
  return <div className="flex h-full min-h-0 flex-col">
    {(mail.error || body.error) && <div role="alert" className="flex items-center justify-between gap-3 border-b p-3 text-sm text-destructive"><span>{mail.error ?? body.error}</span><Button variant="ghost" onClick={() => void mail.refresh()}>重试</Button></div>}
    {!mail.authenticated ? <p className="p-6 text-sm text-muted-foreground">请先登录 Synapse</p> : !mail.accounts.length ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><p className="text-sm text-muted-foreground">尚未添加邮箱</p><Button onClick={onSettings}>添加邮箱</Button></div> : <div className="flex min-h-0 flex-1">
      <aside className="hidden w-52 shrink-0 md:block"><MailNavigation {...mail} onAccount={mail.selectAccount} onView={mail.selectView} onSettings={onSettings} /></aside>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col border-r lg:w-80 lg:flex-none", mail.detail && "hidden lg:flex")}>
        <div className="border-b p-3 md:hidden">
          <div className="flex gap-2 md:hidden"><NativeSelect aria-label="邮箱账号" value={mail.accountId ?? ""} onChange={event => mail.selectAccount(event.target.value)}>{mail.accounts.map(account => <NativeSelectOption value={account.id} key={account.id}>{account.name}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="文件夹" value={mail.view.drafts ? "drafts" : mail.view.starredOnly ? "starred" : mail.view.folderId ?? "all"} onChange={event => { const value = event.target.value; mail.selectView(value === "drafts" ? { drafts: true } : value === "starred" ? { starredOnly: true } : value === "all" ? {} : { folderId: value }) }}><NativeSelectOption value="all">全部邮件</NativeSelectOption><NativeSelectOption value="starred">星标邮件</NativeSelectOption><NativeSelectOption value="drafts">草稿箱</NativeSelectOption>{mail.folders.filter(folder => folder.selectable && folder.role !== "drafts").map(folder => <NativeSelectOption key={folder.id} value={folder.id}>{folderName(folder)}</NativeSelectOption>)}</NativeSelect></div>

        </div>
        <div className="min-h-0 flex-1"><MailList key={`${mail.owner}:${mail.scope?.generation}:${mail.accountId}:${JSON.stringify(mail.view)}`} busy={busy} onSearch={query => void mail.search(query, "body")} coverage={mail.coverage} canContinue={mail.canContinue} onContinue={() => void mail.continueSearch().catch(cause => toast.error(mailError(cause)))} items={mail.items} drafts={mail.drafts} draftView={mail.view.drafts} selected={mail.detail?.id} loading={mail.loading} more={!!mail.cursor} onSelect={id => void mail.selectMessage(id)} onDraft={draftId => onCompose({ draftId })} onMore={() => void mail.loadMore()} onBatch={onBatch} folders={mail.folders} onMove={(ids, target) => void performBatch("move", ids, target)} /></div>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1", !mail.detail && "hidden lg:block")}>
        {mail.detail ? <MailDetail detail={mail.detail} {...body} onBack={mail.clearDetail} onResource={urls => void body.loadRemote(urls)} onDownload={id => void download(id)} onLink={url => void openLink(url)} onReply={mode => onCompose({ accountId: mail.detail!.accountId, sourceMessageId: mail.detail!.id, mode })} onCopy={target => void copy(target)} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一封邮件</div>}
      </div>
    </div>}
    <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) setConfirmation(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmationTitle}</AlertDialogTitle><AlertDialogDescription aria-live={deletingDrafts ? "polite" : undefined} aria-atomic="true">{confirmationDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><Button variant="destructive" disabled={busy} aria-busy={busy} onClick={() => { if (confirmation) void (confirmation.drafts ? performDraftDelete(confirmation.ids) : performBatch("permanent", confirmation.ids)) }}>{busy && <Spinner aria-hidden="true" data-icon="inline-start" className="motion-reduce:animate-none" />}{busy ? "删除中" : confirmation?.drafts ? "删除草稿" : "永久删除"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
