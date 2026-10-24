import { useRef, useState, type ReactElement } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import type { Folder } from "../../../app-capabilities/mail/shared/types"
import { mailError } from "./api"

export type MailFolderChange = (action: "rename" | "delete", folderId: string, name?: string) => Promise<void>

export function MailFolderMenu({ folder, onChange, onRestoreFocus, children }: { folder: Folder; onChange: MailFolderChange; onRestoreFocus(): void; children: ReactElement }) {
  const [action, setAction] = useState<"rename" | "delete" | null>(null)
  const [name, setName] = useState(folder.name), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const trigger = useRef<HTMLSpanElement>(null)
  const restoreFocus = (event: Event) => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); else onRestoreFocus() }
  const begin = (next: "rename" | "delete") => { setName(folder.name); setError(null); setAction(next) }
  const close = (open: boolean) => { if (!open && !lock.current) setAction(null) }
  const submit = async () => {
    if (!action || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await onChange(action, folder.id, action === "rename" ? name.trim() : undefined); setAction(null) }
    catch (cause) { setError(mailError(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <ContextMenu data-track="mail.folder.context_menu">
      <ContextMenuTrigger ref={trigger} asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={event => { if (action) event.preventDefault() }}>
        <ContextMenuItem data-track="mail.folder.rename" onSelect={() => begin("rename")}><Pencil />重命名</ContextMenuItem>
        <ContextMenuItem data-track="mail.folder.delete" variant="destructive" onSelect={() => begin("delete")}><Trash2 />删除文件夹</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <Dialog data-track="mail.folder.rename_dialog" open={action === "rename"} onOpenChange={close}>
      <DialogContent aria-describedby={undefined} onCloseAutoFocus={restoreFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
        <DialogHeader><DialogTitle>重命名文件夹</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
          <div className="space-y-2"><Label htmlFor="mail-folder-name">文件夹名称</Label><Input id="mail-folder-name" value={name} maxLength={255} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "mail-folder-rename-error" : undefined} onChange={event => { setName(event.target.value); setError(null) }} /></div>
          {error && <p id="mail-folder-rename-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={busy}>取消</Button></DialogClose><Button type="submit" disabled={busy || !name.trim()} aria-busy={busy} data-track="mail.folder.rename_confirm">{busy && <Spinner aria-hidden="true" className="motion-reduce:animate-none" />}{busy ? "保存中" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog data-track="mail.folder.delete_dialog" open={action === "delete"} onOpenChange={close}>
      <AlertDialogContent onCloseAutoFocus={restoreFocus}><AlertDialogHeader><AlertDialogTitle>删除文件夹「{folder.name}」？</AlertDialogTitle><AlertDialogDescription>将从邮箱服务器删除此文件夹，仅支持没有邮件和子文件夹的普通文件夹。</AlertDialogDescription></AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><Button variant="destructive" disabled={busy} aria-busy={busy} data-track="mail.folder.delete_confirm" onClick={() => void submit()}>{busy && <Spinner aria-hidden="true" className="motion-reduce:animate-none" />}{busy ? "删除中" : "删除文件夹"}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
