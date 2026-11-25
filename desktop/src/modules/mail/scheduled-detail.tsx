import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CalendarClock, CopyPlus, Download, FilePen, RefreshCw, Send, XCircle } from "lucide-react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/date-time"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { sanitizeMailHtml } from "../../../app-capabilities/mail/renderer/sanitize-body"
import type { Address, ScheduledSendDetail } from "../../../app-capabilities/mail/shared/types"
import { mailApi, mailError } from "./api"
import { MailAddresses } from "./mail-addresses"
import { MailHtmlBody } from "./mail-html-body"
import { MailSchedulePickerDialog } from "./schedule-picker-dialog"
import { scheduledStateMeta } from "./scheduled-list"

function scheduledErrorDescription(detail: ScheduledSendDetail): string | null {
  if (detail.state === "missed") {
    if (detail.errorCode === "ACCOUNT_PAUSED") return "该邮箱已暂停，到点时未自动发送。恢复账号后可修改时间或立即发送。"
    return "已超过预定时间 30 分钟宽限期，未自动发送。可修改时间、立即发送或取消并退回草稿。"
  }
  if (detail.state === "failed") {
    if (detail.errorCode === "ACCOUNT_CHANGED") return "邮箱配置已变更，未向其他服务器发送。请取消定时后重新确认并发送。"
    if (detail.errorCode === "AUTH_FAILED") return "邮箱认证失败，请先在邮箱设置中检查连接后再重试。"
    if (detail.errorCode === "RECIPIENTS_REJECTED") return "服务器拒绝了全部收件人，请取消并检查收件地址。"
    return `自动发送失败（${detail.errorCode ?? "未知原因"}），可修改时间重试或取消并编辑。`
  }
  if (detail.state === "unknown") {
    return "发送过程被中断或未收到完整回执，已停止自动重试以防重复发信。请先核验发送结果，确认未发出时可另存为新草稿。"
  }
  return null
}

export function MailScheduledDetail({
  detail,
  busy,
  onBack,
  onCompose,
  onDownload,
  onLink,
  onReschedule,
  onCancel,
  onCancelAndEdit,
  onSendNow,
  onReconcile,
  onCopyToDraft,
}: {
  detail: ScheduledSendDetail
  busy: boolean
  onBack(): void
  onCompose(recipient: Address): void
  onDownload(assetId: string): void
  onLink(url: string): void
  onReschedule(sendAtIso: string): Promise<void>
  onCancel(): Promise<void>
  onCancelAndEdit(): Promise<void>
  onSendNow(): Promise<void>
  onReconcile(operationId: string): Promise<void>
  onCopyToDraft(): Promise<void>
}) {
  const [body, setBody] = useState<{ html: string; text: string; cid: Record<string, string>; unavailable?: boolean } | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [confirmSendNow, setConfirmSendNow] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    let active = true
    const blobs: string[] = []
    setBody(null)
    setBodyError(null)
    setBodyLoading(true)
    void mailApi().scheduledBody({ scheduledId: detail.id })
      .then(result => {
        if (!active) return
        const cidUrls: Record<string, string> = {}
        for (const [key, image] of Object.entries(result.cid ?? {})) {
          const binary = atob(image.base64)
          const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: image.mime }))
          blobs.push(url)
          cidUrls[key] = url
        }
        setBody({ html: result.html, text: result.text, cid: cidUrls, unavailable: result.unavailable })
      })
      .catch(cause => { if (active) setBodyError(mailError(cause)) })
      .finally(() => { if (active) setBodyLoading(false) })
    return () => {
      active = false
      for (const blob of blobs) URL.revokeObjectURL(blob)
    }
  }, [detail.id, detail.bodyRef])

  const projection = useMemo(() => (body?.html ? sanitizeMailHtml(body.html, { cid: body.cid ?? {}, remote: {} }) : null), [body])
  const mutable = detail.state === "pending" || detail.state === "missed" || detail.state === "failed"
  const meta = scheduledStateMeta[detail.state]
  const notice = scheduledErrorDescription(detail)
  const canReconcile = !!detail.operationId && (detail.state === "unknown" || (detail.state === "sent" && detail.receipt && detail.receipt.sentCopyState !== "saved"))
  const canCopyDraft = !!body && !body.unavailable && (detail.state === "unknown" || detail.state === "sent" || detail.state === "cancelled")

  return (
    <article aria-label="定时邮件详情" className="flex h-full min-h-0 min-w-0 flex-col bg-background" key={detail.id}>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-y-1 border-b bg-background px-3 py-1">
        <SystemAppTopBarActionButton iconOnly className="@min-[53rem]/mail-client:hidden" aria-label="返回定时发送列表" onClick={onBack}><ArrowLeft /></SystemAppTopBarActionButton>
        {mutable && (
          <>
            <SystemAppTopBarActionButton disabled={busy} onClick={() => setRescheduleOpen(true)} data-track="mail.scheduled.reschedule"><CalendarClock />修改时间</SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton disabled={busy} onClick={() => setConfirmSendNow(true)} data-track="mail.scheduled.send_now"><Send />立即发送</SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton disabled={busy} onClick={() => void onCancelAndEdit()} data-track="mail.scheduled.edit"><FilePen />取消并编辑</SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton disabled={busy} tone="destructive" onClick={() => setConfirmCancel(true)} data-track="mail.scheduled.cancel"><XCircle />取消定时</SystemAppTopBarActionButton>
          </>
        )}
        {canReconcile && (
          <SystemAppTopBarActionButton disabled={busy} onClick={() => void onReconcile(detail.operationId!)} data-track="mail.scheduled.reconcile">
            <RefreshCw />{detail.state === "unknown" ? "核验发送结果" : "核验已发送副本"}
          </SystemAppTopBarActionButton>
        )}
        {canCopyDraft && (
          <SystemAppTopBarActionButton disabled={busy} onClick={() => void onCopyToDraft()} data-track="mail.scheduled.copy_draft">
            <CopyPlus />另存为新草稿
          </SystemAppTopBarActionButton>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold leading-snug text-balance break-words">{detail.subject || "（无主题）"}</h2>
              <Badge variant={meta.variant}>{meta.label}</Badge>
            </div>
            {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground">
              <dt className="text-right">发件人</dt>
              <dd className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">{detail.from.address}</dd>
              <dt className="text-right">收件人</dt>
              <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={detail.to} /></dd>
              {detail.cc.length > 0 && (
                <>
                  <dt className="text-right">抄送</dt>
                  <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={detail.cc} /></dd>
                </>
              )}
              {detail.bcc.length > 0 && (
                <>
                  <dt className="text-right">密送</dt>
                  <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={detail.bcc} /></dd>
                </>
              )}
              <dt className="text-right">预定时间</dt>
              <dd className="tabular-nums text-foreground"><time dateTime={detail.sendAt}>{formatDateTime(detail.sendAt)}</time></dd>
              {detail.sentAt && (
                <>
                  <dt className="text-right">实际发送</dt>
                  <dd className="tabular-nums text-foreground"><time dateTime={detail.sentAt}>{formatDateTime(detail.sentAt)}</time></dd>
                </>
              )}
            </dl>
            {detail.receipt && (
              <div role="status" className="space-y-1 rounded-md border p-3 text-xs text-muted-foreground">
                {detail.receipt.accepted.length > 0 && <p className="break-all">已接受：{detail.receipt.accepted.join(", ")}</p>}
                {detail.receipt.rejected.length > 0 && <p className="break-all text-destructive">已拒绝：{detail.receipt.rejected.join(", ")}</p>}
                <p>已发送副本：{detail.receipt.sentCopyState === "saved" ? "已保存" : detail.receipt.sentCopyState === "pending" ? "待核验" : "未确认"}</p>
              </div>
            )}
            {detail.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.attachments.map(asset => (
                  <Button key={asset.id} variant="outline" size="sm" className="max-w-full" onClick={() => onDownload(asset.id)}>
                    <Download />
                    <span className="truncate">{asset.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{Math.ceil(asset.size / 1024)} KB</span>
                  </Button>
                ))}
              </div>
            )}
          </header>

          <Separator className="my-6" />

          <div className="space-y-3">
            {bodyLoading && <Skeleton className="h-32 w-full" />}
            {bodyError && <p role="alert" className="text-sm text-destructive">{bodyError}</p>}
            {body?.unavailable ? (
              <p className="text-sm text-muted-foreground">
                {detail.state === "sent" ? "邮件已发出，本地定时副本已清理，请在「已发送」文件夹查看。" : "定时发送已取消，原内容已退回草稿箱或已清理。"}
              </p>
            ) : projection ? (
              <MailHtmlBody projection={projection} onLink={onLink} />
            ) : (
              body && <pre className="font-sans text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">{body.text}</pre>
            )}
          </div>
        </div>
      </div>

      <MailSchedulePickerDialog
        open={rescheduleOpen}
        title="修改发送时间"
        confirmLabel="保存新时间"
        initialSendAt={detail.sendAt}
        busy={busy}
        onOpenChange={setRescheduleOpen}
        onConfirm={onReschedule}
      />

      <AlertDialog open={confirmSendNow} onOpenChange={open => { if (!busy) setConfirmSendNow(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>立即发送这封邮件？</AlertDialogTitle>
            <AlertDialogDescription>将跳过原定时间，立即通过 SMTP 提交发送。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <Button disabled={busy} onClick={() => { void onSendNow().finally(() => setConfirmSendNow(false)) }}>
              {busy ? "发送中…" : "立即发送"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={open => { if (!busy) setConfirmCancel(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消定时发送？</AlertDialogTitle>
            <AlertDialogDescription>取消后该邮件不会自动发出，内容将退回草稿箱以便继续编辑。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>保留定时</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => { void onCancel().finally(() => setConfirmCancel(false)) }}>
              {busy ? "取消中…" : "确认取消定时"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
