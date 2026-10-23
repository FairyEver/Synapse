import { useMemo } from "react"
import { ArrowLeft, Copy, Download, Reply, ReplyAll, Forward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { MailDetail as Detail } from "../../../app-capabilities/mail/shared/types"
import { sanitizeMailHtml, type MailHtmlResources } from "../../../app-capabilities/mail/renderer/sanitize-body"
import type { MailBody } from "./use-mail-body"
export function MailDetail({ detail, body, resources, onBack, onResource, onDownload, onLink, onReply, onCopy, loading = false }: { detail: Detail; body: MailBody | null; resources: MailHtmlResources; loading?: boolean; onBack(): void; onResource(urls: string[]): void; onDownload(assetId: string): void; onLink(url: string): void; onReply(mode: "reply" | "reply_all" | "forward"): void; onCopy(): void }) {
  const projection = useMemo(() => body?.complete && body.html ? sanitizeMailHtml(body.html, resources) : null, [body, resources])
  return <article aria-label="邮件详情" className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex flex-wrap items-center gap-1 border-b p-2">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="返回邮件列表" onClick={onBack}><ArrowLeft /></Button>
      <Button variant="ghost" size="sm" onClick={() => onReply("reply")} data-track="mail.reply"><Reply />回复</Button><Button variant="ghost" size="sm" onClick={() => onReply("reply_all")}><ReplyAll />回复全部</Button><Button variant="ghost" size="sm" onClick={() => onReply("forward")}><Forward />转发</Button><Button variant="ghost" size="icon-sm" aria-label="复制邮件链接" onClick={onCopy}><Copy /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <h2 className="mb-3 text-lg font-semibold break-words">{detail.subject || "（无主题）"}</h2>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-words"><dt className="text-muted-foreground">发件人</dt><dd>{detail.from.map(from => from.name ? `${from.name} <${from.address}>` : from.address).join(", ")}</dd><dt className="text-muted-foreground">收件人</dt><dd>{detail.to.map(to => to.address).join(", ")}</dd>{detail.cc.length > 0 && <><dt className="text-muted-foreground">抄送</dt><dd>{detail.cc.map(cc => cc.address).join(", ")}</dd></>}{detail.date && <><dt className="text-muted-foreground">时间</dt><dd>{new Date(detail.date).toLocaleString()}</dd></>}</dl>
      {!body && loading && <Skeleton className="h-40 w-full" />}
      {body?.truncated && <p role="status" className="mb-3 text-sm text-muted-foreground">正文未完整读取，显示纯文本</p>}
      {projection ? <iframe title="邮件正文" sandbox="" referrerPolicy="no-referrer" srcDoc={projection.html} className="min-h-96 w-full border-0" /> : <pre className="font-sans text-sm whitespace-pre-wrap break-words">{body?.text ?? ""}</pre>}
      {projection?.remoteImages.length ? <Button variant="outline" onClick={() => onResource(projection.remoteImages)} disabled={loading} className="my-3">加载远程图片</Button> : null}
      {!!projection?.links.length && <div className="my-3 flex flex-wrap gap-2">{projection.links.map((link, index) => <Button variant="link" key={`${link.url}:${index}`} className="h-auto max-w-full whitespace-normal break-all" onClick={() => onLink(link.url)}>{link.label}</Button>)}</div>}
      {detail.attachments.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{detail.attachments.map(asset => <Button key={asset.id} variant="outline" size="sm" onClick={() => onDownload(asset.id)}><Download />{asset.name} · {Math.ceil(asset.size / 1024)} KB</Button>)}</div>}
    </div>
  </article>
}
