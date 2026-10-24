import { useMemo } from "react"
import { ArrowLeft, Copy, Download, Reply, ReplyAll, Forward, MoreHorizontal, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { formatDateTime } from "@/lib/date-time"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { MailDetail as Detail, Address } from "../../../app-capabilities/mail/shared/types"
import { sanitizeMailHtml, type MailHtmlResources } from "../../../app-capabilities/mail/renderer/sanitize-body"
import type { MailBody } from "./use-mail-body"
import { MailAddresses, mailDelegates } from "./mail-addresses"
import { MailHtmlBody } from "./mail-html-body"
export function MailDetail({ detail, body, resources, onBack, onResource, onDownload, onLink, onReply, onCopy, onCompose, loading = false }: { detail: Detail; body: MailBody | null; resources: MailHtmlResources; loading?: boolean; onBack(): void; onResource(urls: string[]): void; onDownload(assetId: string): void; onLink(url: string): void; onReply(mode: "reply" | "reply_all" | "forward"): void; onCopy(target: "id" | "body"): void; onCompose(recipient: Address): void }) {
  const projection = useMemo(() => body?.complete && body.html ? sanitizeMailHtml(body.html, resources) : null, [body, resources])
  const delegates = mailDelegates(detail.from, detail.headers.sender)
  return <article aria-label="邮件详情" className="flex h-full min-h-0 min-w-0 flex-col bg-background" key={detail.id}>
    <div className="flex h-10 shrink-0 items-center border-b bg-background px-3">
      <SystemAppTopBarActionButton iconOnly className="@min-[53rem]/mail-client:hidden" aria-label="返回邮件列表" onClick={onBack}><ArrowLeft /></SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton disabled={detail.metadataTruncated} onClick={() => onReply("reply")} data-track="mail.reply"><Reply />回复</SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton disabled={detail.metadataTruncated} onClick={() => onReply("forward")}><Forward />转发</SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton onClick={() => onCopy("id")}><Copy />复制ID</SystemAppTopBarActionButton>
      <DropdownMenu data-track="mail.detail.more">
        <DropdownMenuTrigger asChild><SystemAppTopBarActionButton className="ml-auto"><MoreHorizontal />更多</SystemAppTopBarActionButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={detail.metadataTruncated} onSelect={() => onReply("reply_all")}><ReplyAll />回复全部</DropdownMenuItem>
          <DropdownMenuItem disabled={!body?.complete} onSelect={() => onCopy("body")}><FileText />复制正文</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-6">
        <header className="space-y-3">
          <h2 className="text-xl font-semibold leading-snug text-balance break-words">{detail.subject || "（无主题）"}</h2>
          {detail.metadataTruncated && <p role="alert" className="text-sm text-destructive">邮件头异常或过大，地址等信息不完整，不能直接回复或转发。</p>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground">
            <dt className="text-right">发件人</dt>
            <dd className="min-w-0 text-sm [overflow-wrap:anywhere]">
              {detail.from.map((from, index) => <span key={`${from.address}-${index}`}>
                {index > 0 && ", "}<span className="font-medium text-foreground">{from.name || from.address}</span>
                {from.name && <span className="text-xs"> {`<${from.address}>`}</span>}
              </span>)}
            </dd>
            {delegates.length > 0 && <>
              <dt className="text-right">代发</dt>
              <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={delegates} showAddress /></dd>
            </>}
            <dt className="text-right">收件人</dt>
            <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={detail.to} /></dd>
            {detail.cc.length > 0 && <>
              <dt className="text-right">抄送</dt>
              <dd className="min-w-0"><MailAddresses onCompose={onCompose} addresses={detail.cc} /></dd>
            </>}
            {detail.date && <>
              <dt className="text-right">时间</dt>
              <dd><time dateTime={detail.date}>{formatDateTime(detail.date)}</time></dd>
            </>}
          </dl>
          {projection?.remoteImages.length ? <Button variant="outline" onClick={() => onResource(projection.remoteImages)} disabled={loading}>加载远程图片</Button> : null}
          {detail.attachments.length > 0 && <div className="flex flex-wrap gap-2">{detail.attachments.map(asset => <Button key={asset.id} data-track="mail.attachment.download" variant="outline" size="sm" className="max-w-full" onClick={() => onDownload(asset.id)}><Download /><span className="truncate">{asset.name}</span><span className="shrink-0 text-muted-foreground">{Math.ceil(asset.size / 1024)} KB</span></Button>)}</div>}
        </header>
        <Separator className="my-6" />
        <div className="space-y-3">
          {!body && loading && <Skeleton className="h-40 w-full" />}
          {body?.truncated && <p role="status" className="text-sm text-muted-foreground">正文未完整读取，显示纯文本</p>}
          {projection ? <MailHtmlBody projection={projection} onLink={onLink} /> : <pre className="font-sans text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">{body?.text ?? ""}</pre>}
        </div>
      </div>
    </div>
  </article>
}
