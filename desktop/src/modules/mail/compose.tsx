import { useRef } from "react"
import { EditorContent } from "@tiptap/react"
import { Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2, Link2, ImagePlus, Paperclip, X, Send, Save } from "lucide-react"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"
import type { AccountSummary } from "../../../app-capabilities/mail/shared/types"
import type { ComposeModel } from "./use-compose"
import { useComposeEditor } from "./use-compose-editor"
import { useComposeAssets } from "./use-compose-assets"
const tools = [{ id: "bold", label: "粗体", Icon: Bold }, { id: "italic", label: "斜体", Icon: Italic }, { id: "underline", label: "下划线", Icon: Underline }, { id: "bulletList", label: "项目列表", Icon: List }, { id: "orderedList", label: "编号列表", Icon: ListOrdered }, { id: "undo", label: "撤销", Icon: Undo2 }, { id: "redo", label: "重做", Icon: Redo2 }] as const
const recipientFields = [{ key: "to", label: "收件人" }, { key: "cc", label: "抄送" }, { key: "bcc", label: "密送" }] as const
const receiptStates = { prepared: "待发送", submitting: "发送中", accepted: "服务器已接受", partial: "部分收件人被拒绝", failed: "发送失败", unknown: "发送结果待核验" }
export function MailCompose({ model, accounts, onRetry, unavailable }: { model: ComposeModel; accounts: AccountSummary[]; onRetry?(): void; unavailable?: string | null }) {
  const composer = useComposeEditor(model), attachments = useComposeAssets(model.draft), imageInput = useRef<HTMLInputElement>(null)
  const draft = model.draft, account = accounts.find(a => a.id === draft?.accountId)
  const disabled = !draft || draft.state !== "editing" || model.sending || model.receipt?.state === "unknown" || model.receipt?.state === "failed"
  const close = () => { void model.close() }
  const sendDisabled = disabled || model.saving || !model.addresses.to.trim() && !model.addresses.cc.trim() && !model.addresses.bcc.trim()
  const save = () => { void model.save().catch(() => undefined) }
  return <><SystemAppWindowShell left={<div className="flex items-center">
    <SystemAppTopBarActionButton disabled={sendDisabled} onClick={() => void model.send()} data-track="mail.send"><Send />{model.sending ? "发送中…" : "发送"}</SystemAppTopBarActionButton>
    <SystemAppTopBarActionButton disabled={disabled || model.saving} onClick={save} data-track="mail.draft.save"><Save />保存草稿</SystemAppTopBarActionButton>
    <SystemAppTopBarActionButton disabled={disabled} onClick={() => void model.pickAttachments()}><Paperclip />附件</SystemAppTopBarActionButton>
  </div>} actions={<><span className="truncate text-sm text-muted-foreground">{account?.email}</span><span role="status" className="shrink-0 text-xs text-muted-foreground">{model.saving ? "保存中…" : model.dirty ? "未保存" : draft?.localSaved ? "已保存" : ""}</span><SystemAppTopBarActionButton iconOnly aria-label="关闭写信" disabled={model.sending || model.saving} onClick={close}><X /></SystemAppTopBarActionButton></>}>
    <div className="flex h-full min-h-0 flex-col bg-background">
      {model.loading && <div role="status" className="flex items-center gap-3 p-4"><Skeleton className="h-4 w-32" /><span className="text-sm text-muted-foreground">正在准备邮件…</span></div>}
      {unavailable && <p role="alert" className="p-4 text-sm text-destructive">{unavailable}</p>}
      {!draft && model.error && <div role="alert" className="flex items-center gap-3 p-4"><span className="text-sm text-destructive">{model.error}</span><Button variant="outline" onClick={onRetry}>重试</Button></div>}
    <div className="flex min-h-0 flex-1 flex-col" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); track({ component: "mail", name: "attachment drop", eventKey: "mail.attachment.drop", action: "drop" }); if (!disabled) void model.importFiles([...event.dataTransfer.files]) }}>
      <div className="flex shrink-0 flex-col gap-3 border-b p-4">
        {recipientFields.map(({ key, label }) => <div key={key} className="grid grid-cols-[4rem_1fr] items-center gap-3"><Label htmlFor={`mail-compose-${key}`}>{label}</Label><Input id={`mail-compose-${key}`} value={model.addresses[key]} disabled={disabled} autoComplete="off" onChange={event => model.changeAddress(key, event.target.value)} data-track={`mail.compose.${key}`} /></div>)}
        <div className="grid grid-cols-[4rem_1fr] items-center gap-3"><Label htmlFor="mail-compose-subject">主题</Label><Input id="mail-compose-subject" value={draft?.subject ?? ""} disabled={disabled} onChange={event => model.edit({ subject: event.target.value })} data-track="mail.compose.subject" /></div>
      </div>
      {attachments.assets.length > 0 && <div className="flex flex-wrap gap-2 border-t p-3">{attachments.assets.map(asset => <div key={asset.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><Paperclip className="size-3" /><span>{asset.name} · {Math.ceil(asset.size / 1024)} KB</span><Button size="icon-xs" variant="ghost" data-track="mail.attachment.remove" aria-label={`移除附件 ${asset.name}`} disabled={disabled} onClick={() => model.edit({ assetIds: draft!.assetIds.filter(id => id !== asset.id) })}><X /></Button></div>)}</div>}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2" role="toolbar" aria-label="正文格式">
        {tools.map(({ id, label, Icon }) => <Button key={id} variant="ghost" size="icon-sm" aria-label={label} aria-pressed={composer.activeMarks.includes(id)} className={cn(composer.activeMarks.includes(id) && "bg-selected")} disabled={disabled} onClick={() => composer.format(id)}><Icon /></Button>)}
        <NativeSelect size="sm" aria-label="字号" defaultValue="16px" disabled={disabled} onChange={event => composer.fontSize(event.target.value)}>{[12, 14, 16, 18, 20, 24, 32].map(size => <NativeSelectOption key={size} value={`${size}px`}>{size}</NativeSelectOption>)}</NativeSelect>
        <Button variant="ghost" size="icon-sm" aria-label="插入链接" disabled={disabled} onClick={() => composer.setLinkOpen(true)}><Link2 /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="插入图片" disabled={disabled} onClick={() => imageInput.current?.click()}><ImagePlus /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="添加附件" disabled={disabled} onClick={() => void model.pickAttachments()}><Paperclip /></Button>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={event => { track({ component: "mail", name: "image selected", eventKey: "mail.image.select", action: "change" }); if (event.target.files) void composer.insertImages([...event.target.files]); event.target.value = "" }} />
      </div>
      <EditorContent className="min-h-0 flex-1 overflow-auto" editor={composer.editor} />
      {(draft && model.error || composer.error || attachments.error) && <p role="alert" className="px-4 py-3 text-sm text-destructive">{model.error ?? composer.error ?? attachments.error}</p>}
      {draft?.state === "conflict" && <p role="alert" className="px-4 py-3 text-sm text-destructive">草稿存在冲突，内容已保留，可另存为新草稿。</p>}
      {model.receipt && <div role="status" className="space-y-1 border-t p-4 text-sm"><p className="font-medium">{receiptStates[model.receipt.state]}</p>{model.receipt.accepted.length > 0 && <p className="break-all">已接受：{model.receipt.accepted.join(", ")}</p>}{model.receipt.rejected.length > 0 && <p className="break-all">已拒绝：{model.receipt.rejected.join(", ")}</p>}<p className="text-muted-foreground">已发送副本：{model.receipt.sentCopyState === "saved" ? "已保存" : model.receipt.sentCopyState === "pending" ? "待核验" : "未确认"}</p>{model.receipt.state === "unknown" && <Button variant="outline" onClick={() => void model.reconcile()}>核验发送结果</Button>}</div>}
      {draft && (draft.state !== "editing" || model.receipt) && <div className="p-3"><Button variant="outline" onClick={() => void model.copyDraft()} disabled={model.sending}>另存为新草稿</Button></div>}
    </div></div>
  </SystemAppWindowShell>
  <AlertDialog open={model.closeRequested} onOpenChange={open => { if (!open) void model.resolveClose("cancel") }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>保存修改？</AlertDialogTitle><AlertDialogDescription>邮件包含未保存的修改。</AlertDialogDescription></AlertDialogHeader>{model.error && <p role="alert" className="text-sm text-destructive">{model.error}</p>}<AlertDialogFooter><Button variant="ghost" disabled={model.saving} onClick={() => void model.resolveClose("cancel")}>取消</Button><Button variant="outline" disabled={model.saving} onClick={() => void model.resolveClose("discard")}>不保存</Button><Button disabled={model.saving} onClick={() => void model.resolveClose("save")}>保存并关闭</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <Dialog open={composer.linkOpen} onOpenChange={composer.setLinkOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>插入链接</DialogTitle></DialogHeader><Label htmlFor="mail-compose-link">地址</Label><Input id="mail-compose-link" value={composer.link} onChange={event => composer.changeLink(event.target.value)} autoFocus />{composer.error && <p role="alert" className="text-sm text-destructive">{composer.error}</p>}<DialogFooter><Button onClick={composer.applyLink}>应用</Button></DialogFooter></DialogContent></Dialog>
  </>
}
