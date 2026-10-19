import { useRef, useState, type ReactNode } from "react"
import { LoaderCircle, X } from "lucide-react"
import { toast } from "sonner"
import type { DriveItemDto, DriveShareListItemDto } from "@synapse/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { RelativeTime } from "@/components/relative-time"
import { driveErrorMessage } from "@/lib/drive-format"
import { getDriveItemSyncStatus, type DriveItemSyncRelation } from "./drive-item-sync"
import type { DriveSyncController } from "./sync"
import { useDriveShareDetails } from "./use-drive-share-details"

/** 一个列表只展开一个 Tag；切换 Tag 或转入管理 Dialog 时不把焦点抢回旧 Tag。 */
export function useDriveStatusPopover() {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const handoffRef = useRef(false)
  const setOpen = (key: string, open: boolean) => {
    if (!open && activeRef.current !== key) return
    activeRef.current = open ? key : null
    if (open) handoffRef.current = false
    setActiveKey(activeRef.current)
  }
  const closeForAction = () => {
    handoffRef.current = true
    activeRef.current = null
    setActiveKey(null)
  }
  return { activeKey, setOpen, closeForAction, isOpen: (key: string) => activeRef.current === key, shouldRestoreFocus: () => activeRef.current === null && !handoffRef.current }
}

type StatusPopoverState = ReturnType<typeof useDriveStatusPopover>
export interface DriveItemStatusTagsProps {
  readonly item: DriveItemDto
  readonly relation: DriveItemSyncRelation | null
  readonly controller: DriveSyncController
  readonly popover: StatusPopoverState
  readonly onManageShare: (share: DriveShareListItemDto) => void
  readonly onCopyShare: (item: DriveItemDto, share: DriveShareListItemDto) => Promise<void>
  readonly onOpenShare: (share: DriveShareListItemDto) => Promise<void>
  readonly onManageSync: (bindingId: string) => void
  readonly onRetrySync: () => Promise<void>
  readonly onRestoreSyncFocus?: () => void
}

export function DriveItemStatusTags(props: DriveItemStatusTagsProps) {
  const shared = Boolean(props.item.shared || props.item.activeShareId || props.item.activeShare)
  if (!shared && !props.relation) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {shared ? <DriveShareTag {...props} /> : null}
      {props.relation ? <DriveSyncTag {...props} relation={props.relation} /> : null}
    </div>
  )
}

function StatusTagPopover({ tagKey, label, title, variant, popover, children, sync = false, showTag = true, onRestoreFocus }: {
  readonly tagKey: string; readonly label: string; readonly title: string
  readonly variant: "outline" | "secondary" | "destructive"
  readonly popover: StatusPopoverState; readonly children: ReactNode; readonly sync?: boolean
  readonly showTag?: boolean; readonly onRestoreFocus?: () => void
}) {
  return (
    <Popover modal open={popover.activeKey === tagKey} onOpenChange={(open) => popover.setOpen(tagKey, open)} data-track={sync ? "drive.file.sync.tag" : "drive.file.share.tag"}>
      {showTag ? <PopoverTrigger asChild>
        <Badge variant={variant} asChild>
          <button type="button" data-slot="badge" data-drive-status-tag={sync ? "sync" : "share"} data-drive-sync-mark={sync || undefined} title={title}>
            {label}
          </button>
        </Badge>
      </PopoverTrigger> : <PopoverAnchor aria-hidden="true" />}
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] max-h-(--radix-popover-content-available-height) overflow-y-auto p-4" aria-label={title}
        onCloseAutoFocus={(event) => {
          if (!popover.shouldRestoreFocus()) event.preventDefault()
          else if (!showTag) { event.preventDefault(); onRestoreFocus?.() }
        }}>
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle>{title}</PopoverTitle>
          <Button variant="ghost" size="icon-sm" onClick={() => popover.setOpen(tagKey, false)} aria-label="关闭详情"><X /><span className="sr-only">关闭详情</span></Button>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  )
}

function DetailFacts({ entries }: { readonly entries: readonly (readonly [string, ReactNode])[] }) {
  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">{entries.map(([label, value]) => <div className="contents" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all">{value}</dd></div>)}</dl>
}

function DriveShareTag({ item, popover, onManageShare, onCopyShare, onOpenShare, controller }: DriveItemStatusTagsProps) {
  const key = `${item.id}:share`
  const share = useDriveShareDetails(item, popover.activeKey === key)
  const expired = share.expired
  const access = share.data?.accessMode === "specified_users_edit" ? `${share.data.editorEmails.length}人可编辑` : share.data?.accessMode === "link_edit" ? "登录可编辑" : "可阅读"
  const manage = () => {
    if (!share.data) return
    popover.closeForAction()
    onManageShare(share.data)
  }
  return (
    <StatusTagPopover tagKey={key} popover={popover} label="分享" title="分享详情" variant="outline">
      <p className="break-all font-medium">{item.name}</p>
      {share.loading ? <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载中</p> : share.error ? <><p role="alert" className="text-destructive">{share.error}</p>{share.canRetry ? <Button variant="outline" onClick={share.retry}>重试</Button> : null}</> : share.data ? <>
        <DetailFacts entries={[
          ["访问权限", access],
          ["有效期", <RelativeTime value={share.data.expiresAt} fallback="永久" />],
          ["访问密码", share.data.passwordEnabled ? "已开启" : "未设置"],
        ]} />
        {expired || share.data.sourceDeleted ? <p className="text-destructive">{share.data.sourceDeleted ? "源文件已删除，链接无法访问。" : "分享已过期，链接无法访问。"}</p> : null}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button disabled={expired || share.data.sourceDeleted} onClick={() => { if (share.data) void onCopyShare(item, share.data) }}>复制链接</Button>
          <Button variant="outline" disabled={expired || share.data.sourceDeleted} onClick={() => { if (share.data) void onOpenShare(share.data) }}>打开</Button>
          <Button variant="outline" disabled={share.data.sourceDeleted || controller.readOnly} onClick={manage}>分享设置</Button>
        </div>
        {controller.readOnly ? <p className="text-muted-foreground">{controller.offline ? "联网后可修改分享设置。" : "登录后可修改分享设置。"}</p> : null}
      </> : null}
    </StatusTagPopover>
  )
}

function DriveSyncTag({ item, relation, controller, popover, onManageSync, onRetrySync, onRestoreSyncFocus }: DriveItemStatusTagsProps & { readonly relation: DriveItemSyncRelation }) {
  const key = `${item.id}:sync`
  const status = getDriveItemSyncStatus(relation, controller.snapshot)
  const [retrying, setRetrying] = useState(false)
  const manage = (bindingId: string) => { popover.closeForAction(); onManageSync(bindingId) }
  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try { await onRetrySync() } catch (cause) { toast(driveErrorMessage(cause, "同步状态加载失败")) } finally { setRetrying(false) }
  }
  const reveal = async (localPath: string) => {
    try { await controller.revealLocalPath(localPath) } catch (cause) { toast(driveErrorMessage(cause, "打开本机位置失败")) }
  }
  const bound = relation.kind === "bound" ? relation : null
  const variant = status.attention ? "destructive" : bound && !bound.excluded ? "secondary" : "outline"
  return (
    <StatusTagPopover tagKey={key} popover={popover} label="同步" title="本机同步" variant={variant} sync showTag={relation.kind !== "unknown"} onRestoreFocus={onRestoreSyncFocus}>
      <p className="break-all font-medium">{item.name}</p>
      {bound ? <DetailFacts entries={[
        ["同步来源", bound.inherited ? `随文件夹 ${bound.binding.driveItemName}` : "独立同步"],
        ["同步方向", "本机 ⇄ 云盘"],
        ["本机位置", bound.localPath],
        ["状态", status.label === "同步" ? "已建立同步关系" : status.label],
        [bound.inherited ? "关系最近同步" : "最近同步", <RelativeTime value={bound.binding.lastSyncedAt} fallback="尚未完成首次同步" />],
      ]} /> : null}
      <p className={status.attention ? "text-destructive" : "text-muted-foreground"}>{status.detail}</p>
      {bound ? <div className="flex flex-wrap items-center gap-2 pt-2">
        {!bound.excluded ? <Button variant="outline" onClick={() => void reveal(bound.localPath)}>打开本机位置</Button> : null}
        <Button onClick={() => manage(bound.binding.id)}>{bound.inherited ? "管理文件夹同步" : "同步详情"}</Button>
      </div> : relation.kind === "contains" ? <>
        <ul className="flex flex-col gap-2">{relation.bindings.map((binding) => <li key={binding.id} className="flex items-center justify-between gap-2"><span className="min-w-0 break-all">{binding.drivePathHint || binding.driveItemName}</span><Button variant="outline" size="sm" onClick={() => manage(binding.id)}>查看</Button></li>)}</ul>
        {relation.incomplete ? <><p className="text-destructive">部分同步关系加载失败</p><Button variant="outline" disabled={retrying} onClick={() => void retry()}>重试</Button></> : null}
      </> : relation.kind === "unknown" && !relation.loading ? <Button variant="outline" disabled={retrying} onClick={() => void retry()}>{retrying ? "重试中" : "重试"}</Button> : null}
    </StatusTagPopover>
  )
}
