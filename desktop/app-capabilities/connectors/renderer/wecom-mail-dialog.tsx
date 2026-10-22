import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Mail, Search, Send } from "lucide-react"
import { toast } from "sonner"
import { MarkdownViewer } from "../../../src/components/markdown-viewer"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../../src/components/ui/empty"
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { cn } from "../../../src/lib/utils"
import type { ConnectorItem } from "../shared/schema"
import type { WecomMailDetail, WecomMailSummary } from "../shared/wecom-mail"

type WecomMailDialogProps = {
  readonly connector: ConnectorItem
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

type ComposeState = {
  readonly replyTo: WecomMailDetail | null
}

export function WecomMailDialog({ connector, open, onOpenChange }: WecomMailDialogProps) {
  const bridge = useMemo(() => requireBridgeDomain("connectors"), [])
  const shellBridge = useMemo(() => requireBridgeDomain("shell"), [])
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<WecomMailSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selected, setSelected] = useState<WecomMailDetail | null>(null)
  const [compose, setCompose] = useState<ComposeState | null>(null)

  const load = useCallback(async (options: { readonly append?: boolean; readonly cursor?: string | null; readonly search?: string } = {}) => {
    setLoading(true)
    try {
      const result = await bridge.mail.search({
        id: connector.id,
        input: {
          ...(options.search?.trim() ? { query: options.search.trim() } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          limit: 50,
        },
      })
      setItems((current) => options.append ? [...current, ...result.items] : result.items)
      setNextCursor(result.nextCursor)
      setHasMore(result.hasMore)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载邮件失败")
    } finally {
      setLoading(false)
    }
  }, [bridge, connector.id])

  const openPermissionHelp = useCallback(async () => {
    if (!connector.helpUrl) return
    try {
      await shellBridge.openExternal(connector.helpUrl)
    } catch {
      toast.error("无法打开权限申请页面")
    }
  }, [connector.helpUrl, shellBridge])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setItems([])
    setSelected(null)
    setCompose(null)
    void load()
  }, [load, open])

  const openMail = async (mail: WecomMailSummary) => {
    setDetailLoading(true)
    try {
      const detail = await bridge.mail.get({ id: connector.id, input: { mailId: mail.mailId } })
      setSelected({
        ...detail,
        sendTime: detail.sendTime || mail.sendTime,
        isRead: mail.isRead,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取邮件失败")
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} data-track="connectors.wecom-mail.dialog">
        <DialogContent className="h-[min(48rem,calc(100vh-2rem))] max-w-6xl p-0" showCloseButton={false}>
          <DialogFrame>
            <DialogFrameHeader
              bordered
              title="企业微信邮箱"
              description={connector.mailbox?.address ?? connector.mailbox?.displayName ?? "已连接"}
              actions={(
                <Button type="button" data-track="connectors.wecom-mail.compose" onClick={() => setCompose({ replyTo: null })}>
                  <Send data-icon="inline-start" />
                  写邮件
                </Button>
              )}
            />
            <DialogFrameBody className="@container/wecom-mail grid min-h-0 grid-cols-1 @3xl/wecom-mail:grid-cols-[22rem_minmax(0,1fr)]">
              <aside className={cn("min-h-0 flex-col border-b @3xl/wecom-mail:border-r @3xl/wecom-mail:border-b-0", selected ? "hidden @3xl/wecom-mail:flex" : "flex")}>
                <form
                  className="flex shrink-0 gap-2 p-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setSelected(null)
                    void load({ search: query })
                  }}
                >
                  <Input
                    aria-label="搜索邮件"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索主题或正文"
                    data-track="connectors.wecom-mail.search"
                  />
                  <Button type="submit" variant="outline" size="icon" aria-label="搜索" data-track="connectors.wecom-mail.search.submit">
                    {loading ? <Spinner /> : <Search />}
                  </Button>
                </form>
                {connector.warningMessage ? (
                  <Alert variant="destructive" className="mx-3 mb-3 shrink-0">
                    <AlertTitle>缺少邮件读取权限</AlertTitle>
                    <AlertDescription>
                      <p className="whitespace-pre-line">{connector.warningMessage}</p>
                      {connector.helpUrl ? (
                        <Button type="button" variant="outline" className="mt-2" data-track="connectors.wecom-mail.permission.apply" onClick={() => void openPermissionHelp()}>
                          申请邮箱权限
                        </Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <ScrollArea className="min-h-0 flex-1">
                  {loading && items.length === 0 ? (
                    <div className="flex items-center justify-center py-12"><Spinner /></div>
                  ) : items.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">没有邮件</p>
                  ) : (
                    <div role="list" aria-label="邮件列表">
                      {items.map((mail) => (
                        <button
                          key={mail.mailId}
                          type="button"
                          role="listitem"
                          data-track="connectors.wecom-mail.message.open"
                          className={cn(
                            "block w-full border-b px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                            selected?.mailId === mail.mailId && "bg-selected hover:bg-selected",
                          )}
                          onClick={() => void openMail(mail)}
                        >
                          <div className="flex items-start gap-2">
                            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", mail.isRead ? "bg-transparent" : "bg-foreground")} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-sm font-medium">{mail.sender.name || mail.sender.email}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{formatMailTime(mail.sendTime)}</span>
                              </div>
                              <p className="mt-1 truncate text-sm">{mail.subject || "无主题"}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                      {hasMore && nextCursor ? (
                        <div className="p-3">
                          <Button type="button" variant="outline" className="w-full" disabled={loading} data-track="connectors.wecom-mail.load-more" onClick={() => void load({ append: true, cursor: nextCursor, search: query })}>
                            {loading ? <Spinner /> : null}
                            加载更多
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </ScrollArea>
              </aside>
              <section className={cn("min-h-0 flex-col overflow-y-auto p-5", selected ? "flex" : "hidden @3xl/wecom-mail:flex")}>
                {detailLoading ? (
                  <div className="flex flex-1 items-center justify-center"><Spinner /></div>
                ) : selected ? (
                  <>
                    <Button type="button" variant="ghost" className="mb-4 self-start @3xl/wecom-mail:hidden" data-track="connectors.wecom-mail.message.back" onClick={() => setSelected(null)}>
                      <ArrowLeft data-icon="inline-start" />
                      返回
                    </Button>
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="min-w-0 text-lg font-semibold">{selected.subject || "无主题"}</h2>
                      <Button type="button" variant="outline" data-track="connectors.wecom-mail.message.reply" onClick={() => setCompose({ replyTo: selected })}>
                        回复
                      </Button>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <p>{selected.sender.name || selected.sender.email} &lt;{selected.sender.email}&gt;</p>
                      <p>{formatMailTime(selected.sendTime)}</p>
                      <p>收件人：{selected.to.map(personLabel).join("、") || "无"}</p>
                      {selected.cc.length ? <p>抄送：{selected.cc.map(personLabel).join("、")}</p> : null}
                    </div>
                    <div className="mt-6">
                      <MarkdownViewer content={selected.content || "无正文"} showTabs={false} surface="plain" />
                    </div>
                    {selected.attachments.length ? (
                      <div className="mt-6 border-t pt-4">
                        <h3 className="text-sm font-medium">附件</h3>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {selected.attachments.map((attachment) => (
                            <li key={`${attachment.name}-${attachment.size ?? 0}`}>{attachment.name}{attachment.size !== undefined ? ` · ${formatBytes(attachment.size)}` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Empty className="flex-1">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><Mail /></EmptyMedia>
                      <EmptyTitle>选择一封邮件</EmptyTitle>
                      <EmptyDescription>从左侧列表打开邮件。</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent />
                  </Empty>
                )}
              </section>
            </DialogFrameBody>
          </DialogFrame>
        </DialogContent>
      </Dialog>
      <WecomMailComposeDialog
        connectorId={connector.id}
        open={compose !== null}
        replyTo={compose?.replyTo ?? null}
        onOpenChange={(next) => { if (!next) setCompose(null) }}
        onSent={() => {
          setCompose(null)
          void load({ search: query })
        }}
      />
    </>
  )
}

function WecomMailComposeDialog({ connectorId, open, replyTo, onOpenChange, onSent }: {
  readonly connectorId: string
  readonly open: boolean
  readonly replyTo: WecomMailDetail | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSent: () => void
}) {
  const bridge = useMemo(() => requireBridgeDomain("connectors"), [])
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    setTo(replyTo?.sender.email ?? "")
    setCc("")
    setSubject(replyTo ? replySubject(replyTo.subject) : "")
    setBody("")
    setSending(false)
  }, [open, replyTo])

  const send = async () => {
    const recipients = parseEmails(to)
    const ccRecipients = parseEmails(cc)
    if (!recipients.length) {
      toast.error("请填写收件人")
      return
    }
    setSending(true)
    try {
      await bridge.mail.send({
        id: connectorId,
        input: {
          to: recipients,
          ...(ccRecipients.length ? { cc: ccRecipients } : {}),
          subject,
          body,
          ...(replyTo ? { replyToMailId: replyTo.mailId, replyAll: false } : {}),
        },
      })
      toast.success(replyTo ? "邮件已回复" : "邮件已发送")
      onSent()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送邮件失败")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="connectors.wecom-mail.compose.dialog">
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{replyTo ? "回复邮件" : "写邮件"}</DialogTitle>
          <DialogDescription>邮件由当前企业微信授权账号发送。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="wecom-mail-to">收件人</Label>
            <Input id="wecom-mail-to" value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com，多个地址用逗号分隔" data-track="connectors.wecom-mail.compose.to" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wecom-mail-cc">抄送</Label>
            <Input id="wecom-mail-cc" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="可选" data-track="connectors.wecom-mail.compose.cc" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wecom-mail-subject">主题</Label>
            <Input id="wecom-mail-subject" value={subject} onChange={(event) => setSubject(event.target.value)} data-track="connectors.wecom-mail.compose.subject" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wecom-mail-body">正文</Label>
            <Textarea id="wecom-mail-body" className="min-h-64 resize-y" value={body} onChange={(event) => setBody(event.target.value)} data-track="connectors.wecom-mail.compose.body" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={sending} data-track="connectors.wecom-mail.compose.send" onClick={() => void send()}>
            {sending ? <Spinner /> : <Send data-icon="inline-start" />}
            {replyTo ? "回复" : "发送"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function parseEmails(value: string): string[] {
  return [...new Set(value.split(/[,\n;，；]/u).map((item) => item.trim()).filter(Boolean))]
}

function replySubject(subject: string): string {
  const trimmed = subject.trim()
  return /^(?:回复|re)\s*[:：]/iu.test(trimmed) ? trimmed : `回复：${trimmed}`
}

function personLabel(person: { readonly name: string; readonly email: string }): string {
  return person.name ? `${person.name} <${person.email}>` : person.email
}

function formatMailTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
