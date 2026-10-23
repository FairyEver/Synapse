import { useRef } from "react"
import { EditorContent } from "@tiptap/react"
import { Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2, Link2, ImagePlus, Paperclip, X } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"
import { sanitizeMailHtml } from "../../../app-capabilities/mail/renderer/sanitize-body"
import type { AccountSummary } from "../../../app-capabilities/mail/shared/types"
import type { ComposeModel } from "./use-compose"
import { useComposeEditor } from "./use-compose-editor"
import { useComposeAssets } from "./use-compose-assets"
const tools = [{ id: "bold", label: "粗体", Icon: Bold }, { id: "italic", label: "斜体", Icon: Italic }, { id: "underline", label: "下划线", Icon: Underline }, { id: "bulletList", label: "项目列表", Icon: List }, { id: "orderedList", label: "编号列表", Icon: ListOrdered }, { id: "undo", label: "撤销", Icon: Undo2 }, { id: "redo", label: "重做", Icon: Redo2 }] as const
const recipientFields = [{ key: "to", label: "收件人" }, { key: "cc", label: "抄送" }, { key: "bcc", label: "密送" }] as const
const receiptStates = { prepared: "待发送", submitting: "发送中", accepted: "服务器已接受", partial: "部分收件人被拒绝", failed: "发送失败", unknown: "发送结果待核验" }
export function MailCompose({ model, accounts }: { model: ComposeModel; accounts: AccountSummary[] }) {
  const composer = useComposeEditor(model), attachments = useComposeAssets(model.draft), imageInput = useRef<HTMLInputElement>(null)
  const draft = model.draft, account = accounts.find(a => a.id === draft?.accountId)
  const disabled = !draft || draft.state !== "editing" || model.sending || model.receipt?.state === "unknown" || model.receipt?.state === "failed"
  const preview = model.preview
  const previewHtml = preview ? sanitizeMailHtml(preview.draft.html, { cid: {}, remote: {} }).html : ""
  const close = () => { void model.close() }
  return <><Sheet open={!!draft || model.loading} onOpenChange={open => { if (!open) close() }} data-track="mail.compose"><SheetContent side="right" className="w-full gap-0 sm:max-w-3xl" aria-describedby={undefined} showCloseButton={false}>
    <SheetHeader className="border-b"><div className="flex items-center justify-between gap-3"><SheetTitle>{draft?.mode === "reply" || draft?.mode === "reply_all" ? "回复邮件" : draft?.mode === "forward" ? "转发邮件" : "新邮件"}</SheetTitle><Button variant="ghost" size="icon-sm" aria-label="保存并关闭写信" disabled={model.sending || model.loading} onClick={close}><X /></Button></div>{account && <p className="text-sm text-muted-foreground">发件人：{account.email}</p>}</SheetHeader>
    <div className="min-h-0 flex-1 overflow-auto" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); track({ component: "mail", name: "attachment drop", eventKey: "mail.attachment.drop", action: "drop" }); if (!disabled) void model.importFiles([...event.dataTransfer.files]) }}>
      <div className="space-y-3 border-b p-4">
        {recipientFields.map(({ key, label }) => <div key={key} className="grid grid-cols-[4rem_1fr] items-center gap-3"><Label htmlFor={`mail-compose-${key}`}>{label}</Label><Input id={`mail-compose-${key}`} value={model.addresses[key]} disabled={disabled} autoComplete="off" onChange={event => model.changeAddress(key, event.target.value)} data-track={`mail.compose.${key}`} /></div>)}
        <div className="grid grid-cols-[4rem_1fr] items-center gap-3"><Label htmlFor="mail-compose-subject">主题</Label><Input id="mail-compose-subject" value={draft?.subject ?? ""} disabled={disabled} onChange={event => model.edit({ subject: event.target.value })} data-track="mail.compose.subject" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2" role="toolbar" aria-label="正文格式">
        {tools.map(({ id, label, Icon }) => <Button key={id} variant="ghost" size="icon-sm" aria-label={label} aria-pressed={composer.activeMarks.includes(id)} className={cn(composer.activeMarks.includes(id) && "bg-selected")} disabled={disabled} onClick={() => composer.format(id)}><Icon /></Button>)}
        <NativeSelect size="sm" aria-label="字号" defaultValue="16px" disabled={disabled} onChange={event => composer.fontSize(event.target.value)}>{[12, 14, 16, 18, 20, 24, 32].map(size => <NativeSelectOption key={size} value={`${size}px`}>{size}</NativeSelectOption>)}</NativeSelect>
        <Button variant="ghost" size="icon-sm" aria-label="插入链接" disabled={disabled} onClick={() => composer.setLinkOpen(true)}><Link2 /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="插入图片" disabled={disabled} onClick={() => imageInput.current?.click()}><ImagePlus /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="添加附件" disabled={disabled} onClick={() => void model.pickAttachments()}><Paperclip /></Button>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={event => { track({ component: "mail", name: "image selected", eventKey: "mail.image.select", action: "change" }); if (event.target.files) void composer.insertImages([...event.target.files]); event.target.value = "" }} />
      </div>
      <EditorContent editor={composer.editor} />
      {attachments.assets.length > 0 && <div className="flex flex-wrap gap-2 border-t p-3">{attachments.assets.map(asset => <div key={asset.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><Paperclip className="size-3" /><span>{asset.name} · {Math.ceil(asset.size / 1024)} KB</span><Button size="icon-xs" variant="ghost" aria-label={`移除附件 ${asset.name}`} disabled={disabled} onClick={() => model.edit({ assetIds: draft!.assetIds.filter(id => id !== asset.id) })}><X /></Button></div>)}</div>}
      {(model.error || composer.error || attachments.error) && <p role="alert" className="px-4 py-3 text-sm text-destructive">{model.error ?? composer.error ?? attachments.error}</p>}
      {draft?.state === "conflict" && <p role="alert" className="px-4 py-3 text-sm text-destructive">草稿存在冲突，内容已保留，可另存为新草稿。</p>}
      {model.receipt && <div role="status" className="space-y-1 border-t p-4 text-sm"><p className="font-medium">{receiptStates[model.receipt.state]}</p>{model.receipt.accepted.length > 0 && <p className="break-all">已接受：{model.receipt.accepted.join(", ")}</p>}{model.receipt.rejected.length > 0 && <p className="break-all">已拒绝：{model.receipt.rejected.join(", ")}</p>}<p className="text-muted-foreground">已发送副本：{model.receipt.sentCopyState === "saved" ? "已保存" : model.receipt.sentCopyState === "pending" ? "待核验" : "未确认"}</p>{model.receipt.state === "unknown" && <Button variant="outline" onClick={() => void model.reconcile()}>核验发送结果</Button>}</div>}
      {preview && !model.receipt && <details className="border-t p-4" open><summary className="cursor-pointer text-sm font-medium">发送预览</summary><div className="space-y-2 pt-3 text-sm"><p>发件人：{preview.from.address}</p>{recipientFields.map(({ key, label }) => <p key={key} className="break-all">{label}：{preview.draft[key].map(a => a.address).join(", ")}</p>)}<p>主题：{preview.draft.subject || "（无主题）"}</p>{preview.attachments.map(asset => <p key={asset.id}>{asset.name} · {asset.size} 字节</p>)}<iframe title="发送正文预览" sandbox="" referrerPolicy="no-referrer" className="min-h-64 w-full border-0" srcDoc={previewHtml} /></div></details>}
    </div>
    <SheetFooter className="flex-row items-center justify-between border-t"><span role="status" className="text-xs text-muted-foreground">{model.saving ? "保存中…" : model.dirty ? "未保存" : draft?.localSaved ? draft.syncState === "synced" ? "已同步草稿箱" : "已存本机" : ""}</span><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={close} disabled={model.sending}>关闭</Button>{draft && (draft.state !== "editing" || model.error || model.receipt) && <Button variant="outline" onClick={() => void model.copyDraft()} disabled={model.sending}>另存为新草稿</Button>}{!disabled && <><Button variant="outline" disabled={model.saving} onClick={() => void model.preparePreview().catch(() => undefined)}>预览</Button><Button disabled={model.saving || model.sending || !model.addresses.to.trim() && !model.addresses.cc.trim() && !model.addresses.bcc.trim()} onClick={() => void model.send()} data-track="mail.send">{model.sending ? "发送中…" : "发送"}</Button></>}</div></SheetFooter>
  </SheetContent></Sheet>
  <Dialog open={composer.linkOpen} onOpenChange={composer.setLinkOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>插入链接</DialogTitle></DialogHeader><Label htmlFor="mail-compose-link">地址</Label><Input id="mail-compose-link" value={composer.link} onChange={event => composer.changeLink(event.target.value)} autoFocus />{composer.error && <p role="alert" className="text-sm text-destructive">{composer.error}</p>}<DialogFooter><Button onClick={composer.applyLink}>应用</Button></DialogFooter></DialogContent></Dialog>
  </>
}
