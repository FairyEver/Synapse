import { useState, type ReactNode } from "react"
import { ArrowLeft, Search, X, Info, ChevronDown, Pause, CircleAlert, CircleSlash, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import type { Coverage, Folder } from "../../../app-capabilities/mail/shared/types"
import { folderName } from "./navigation"
import type { MailSyncStatus } from "./use-mail-sync"
export type BatchAction = "read" | "unread" | "star" | "unstar" | "delete" | "restore" | "permanent"
export interface MailSearchControls { onSearch?(query: string): void; coverage?: Coverage | null; canContinue?: boolean; onContinue?(): void; syncStatus?: MailSyncStatus | null }
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
export function MailListToolbar({ count, all, disabled, busy, loading, draftView, onToggle, onBatch, onMove, folders, canPermanentlyDelete, onSearch, coverage, canContinue, onContinue, syncStatus }: MailSearchControls & {
  count: number; all: boolean; disabled: boolean; busy?: boolean; loading?: boolean; draftView?: boolean; onToggle(value: boolean): void; onBatch(action: BatchAction): void; onMove(id: string): void; folders: Folder[]; canPermanentlyDelete: boolean
}) {
  const [searching, setSearching] = useState(false), [query, setQuery] = useState("")
  const [hovering, setHovering] = useState(false), [searchFocused, setSearchFocused] = useState(false)
  const searchActive = count === 0 && searching
  const itemName = draftView ? "草稿" : "邮件"
  const status = coverage?.reason === "body_truncated" ? "部分正文未完整检索" : canContinue ? "部分邮件尚未检索" : !syncStatus && coverage && !coverage.metadataComplete ? "部分邮件尚未同步" : null
  const SyncIcon = syncStatus?.state === "paused" ? Pause : syncStatus?.state === "failed" ? CircleAlert : syncStatus?.state === "cancelled" ? CircleSlash : Clock
  const syncLabel = syncStatus ? [syncStatus.label, syncStatus.progress].filter(Boolean).join("，") : ""
  const exitSearch = () => { setSearching(false); setQuery(""); onSearch?.("") }
  const syncing = syncStatus?.state === "running"
  // Background refresh must not replace controls while the user is approaching or using search.
  const preserveSearch = searching || searchFocused || Boolean(onSearch && hovering)
  if ((loading || syncing) && !preserveSearch) {
    const progressLabel = syncing ? syncLabel : "加载邮件中"
    const percentage = syncing ? syncStatus.percentage : null
    return <TooltipProvider><div className="flex h-10 shrink-0 items-center justify-end border-b bg-background px-3" aria-label="邮件列表工具栏" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} aria-busy="true">
      <Hint label={progressLabel}>
        <span tabIndex={0} className="flex h-8 shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Progress className="w-16" value={percentage} aria-label={progressLabel} aria-valuenow={percentage ?? undefined} aria-valuetext={progressLabel} />
        </span>
      </Hint>
    </div></TooltipProvider>
  }
  return <TooltipProvider><div className="flex h-10 shrink-0 items-center border-b bg-background px-3" aria-label="邮件列表工具栏" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
    {searchActive ? <SystemAppTopBarActionButton type="button" iconOnly aria-label="退出搜索" onClick={exitSearch}><ArrowLeft /></SystemAppTopBarActionButton> : <>
      <Checkbox aria-label={`选择当前页${itemName}`} checked={all ? true : count ? "indeterminate" : false} onCheckedChange={value => onToggle(value === true)} disabled={disabled || busy} />
      {count > 0 && <span className="ml-2 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-label={`已选 ${count} 封${itemName}`}>{count}</span>}
    </>}
    {status && <Popover><Hint label={status}><PopoverTrigger asChild><SystemAppTopBarActionButton iconOnly aria-label={status}><Info /></SystemAppTopBarActionButton></PopoverTrigger></Hint><PopoverContent align="start" className="w-64"><p className="text-sm">{status}</p>{canContinue && <Button variant="ghost" className="mt-2" disabled={busy} onClick={onContinue}>继续检索</Button>}</PopoverContent></Popover>}
    {syncStatus && !syncing && syncStatus.state !== "completed" && <Popover><Hint label={syncLabel}><PopoverTrigger asChild><SystemAppTopBarActionButton iconOnly={searchActive} aria-label={syncLabel} className="min-w-0 shrink"><SyncIcon />{!searchActive && <><span className="truncate">{syncStatus.label}</span>{syncStatus.count && <span className="tabular-nums">{syncStatus.count}</span>}</>}</SystemAppTopBarActionButton></PopoverTrigger></Hint><PopoverContent align="start" className="w-64 space-y-2 text-sm"><p>{syncStatus.label}</p>{syncStatus.progress && <p className="tabular-nums text-muted-foreground">{syncStatus.progress}</p>}{syncStatus.error && <p className="text-destructive">{syncStatus.error}</p>}</PopoverContent></Popover>}
    {searchActive ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={event => { event.preventDefault(); onSearch?.(query) }}>
      <InputGroup><InputGroupInput autoFocus aria-label="搜索邮件" placeholder="搜索邮件" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") exitSearch() }} />
        <InputGroupAddon align="inline-end">{query && <InputGroupButton aria-label="清空搜索" size="icon-xs" onClick={() => { setQuery(""); onSearch?.("") }}><X /></InputGroupButton>}<InputGroupButton type="submit" size="icon-xs" aria-label="提交搜索"><Search /></InputGroupButton></InputGroupAddon>
      </InputGroup>
    </form> : <><div className="flex-1" />{count > 0 ?
        <DropdownMenu><DropdownMenuTrigger asChild><SystemAppTopBarActionButton disabled={busy}>操作<ChevronDown data-icon="inline-end" /></SystemAppTopBarActionButton></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
          {draftView ? <DropdownMenuItem variant="destructive" onSelect={() => onBatch("delete")}>删除草稿</DropdownMenuItem> : <>
          <DropdownMenuItem onSelect={() => onBatch("read")}>标记已读</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("unread")}>标记未读</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("star")}>加星标</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("unstar")}>取消星标</DropdownMenuItem>
          <DropdownMenuSub><DropdownMenuSubTrigger>移动至</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuGroup>{folders.filter(f => f.selectable && f.role !== "drafts").map(folder => <DropdownMenuItem key={folder.id} onSelect={() => onMove(folder.id)}>{folderName(folder)}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuSubContent></DropdownMenuSub>
          <DropdownMenuItem onSelect={() => onBatch("delete")}>移至回收站</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("restore")}>恢复到收件箱</DropdownMenuItem>{canPermanentlyDelete && <DropdownMenuItem variant="destructive" onSelect={() => onBatch("permanent")}>永久删除</DropdownMenuItem>}
          </>}
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      : onSearch && <Hint label="搜索邮件"><SystemAppTopBarActionButton iconOnly aria-label="搜索邮件" onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onClick={() => { setSearchFocused(false); setSearching(true) }}><Search /></SystemAppTopBarActionButton></Hint>}</>}
  </div></TooltipProvider>
}
