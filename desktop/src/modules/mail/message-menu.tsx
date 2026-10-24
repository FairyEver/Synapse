import type { ReactElement } from "react"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from "@/components/ui/context-menu"
import type { Folder } from "../../../app-capabilities/mail/shared/types"
import type { BatchAction } from "./list-toolbar"
import { folderName } from "./navigation"

export function MailMessageMenu({ id, draftView, canPermanentlyDelete, folders, busy, onBatch, onMove, children }: {
  id: string
  draftView?: boolean
  canPermanentlyDelete?: boolean
  folders: Folder[]
  busy?: boolean
  onBatch(action: BatchAction, ids: string[]): void
  onMove(ids: string[], folderId: string): void
  children: ReactElement
}) {
  return <ContextMenu data-track={draftView ? "mail.draft.context_menu" : "mail.message.context_menu"}>
    <ContextMenuTrigger asChild disabled={busy}>{children}</ContextMenuTrigger>
    <ContextMenuContent onClick={event => event.stopPropagation()}>
      {draftView ? <ContextMenuItem disabled={busy} variant="destructive" onSelect={() => onBatch("delete", [id])}>删除草稿</ContextMenuItem> : <>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("read", [id])}>标记已读</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("unread", [id])}>标记未读</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("star", [id])}>加星标</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("unstar", [id])}>取消星标</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={busy}>移动至</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {folders.filter(folder => folder.selectable && folder.role !== "drafts").map(folder => <ContextMenuItem key={folder.id} disabled={busy} onSelect={() => onMove([id], folder.id)}>{folderName(folder)}</ContextMenuItem>)}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("delete", [id])}>移至回收站</ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={() => onBatch("restore", [id])}>恢复到收件箱</ContextMenuItem>
        {canPermanentlyDelete && <ContextMenuItem disabled={busy} variant="destructive" onSelect={() => onBatch("permanent", [id])}>永久删除</ContextMenuItem>}
      </>}
    </ContextMenuContent>
  </ContextMenu>
}
