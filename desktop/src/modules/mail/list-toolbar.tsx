import { useState, type ReactNode } from "react"
import { ArrowLeft, Search, X, LoaderCircle, Info, ChevronDown, Pause, CircleAlert, CircleSlash, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
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
export function MailListToolbar({ count, all, disabled, busy, draftView, onToggle, onBatch, onMove, folders, canPermanentlyDelete, onSearch, coverage, canContinue, onContinue, syncStatus }: MailSearchControls & {
  count: number; all: boolean; disabled: boolean; busy?: boolean; draftView?: boolean; onToggle(value: boolean): void; onBatch(action: BatchAction): void; onMove(id: string): void; folders: Folder[]; canPermanentlyDelete: boolean
}) {
  const [searching, setSearching] = useState(false), [query, setQuery] = useState("")
  const itemName = draftView ? "草稿" : "邮件"
  const status = coverage?.reason === "body_truncated" ? "部分正文未完整检索" : canContinue ? "部分邮件尚未检索" : !syncStatus && coverage && !coverage.metadataComplete ? "部分邮件尚未同步" : null
  const SyncIcon = syncStatus?.state === "running" ? LoaderCircle : syncStatus?.state === "paused" ? Pause : syncStatus?.state === "failed" ? CircleAlert : syncStatus?.state === "cancelled" ? CircleSlash : Clock
  const syncLabel = syncStatus ? [syncStatus.label, syncStatus.progress].filter(Boolean).join("，") : ""
  const exitSearch = () => { setSearching(false); setQuery(""); onSearch?.("") }
  return <TooltipProvider><div className="flex h-10 shrink-0 items-center border-b bg-background px-3" aria-label="邮件列表工具栏">
    {count === 0 && searching ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={event => { event.preventDefault(); onSearch?.(query) }}>
      <SystemAppTopBarActionButton type="button" iconOnly aria-label="退出搜索" onClick={exitSearch}><ArrowLeft /></SystemAppTopBarActionButton>
      <InputGroup><InputGroupInput autoFocus aria-label="搜索邮件" placeholder="搜索邮件" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") exitSearch() }} />
        <InputGroupAddon align="inline-end">{query && <InputGroupButton aria-label="清空搜索" size="icon-xs" onClick={() => { setQuery(""); onSearch?.("") }}><X /></InputGroupButton>}<InputGroupButton type="submit" size="icon-xs" aria-label="提交搜索"><Search /></InputGroupButton></InputGroupAddon>
      </InputGroup>
    </form> : <>
      <Checkbox aria-label={`选择当前页${itemName}`} checked={all ? true : count ? "indeterminate" : false} onCheckedChange={value => onToggle(value === true)} disabled={disabled || busy} />
      {count > 0 ? <><span className="ml-2 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-label={`已选 ${count} 封${itemName}`}>{count}</span><div className="flex-1" />
        <DropdownMenu><DropdownMenuTrigger asChild><SystemAppTopBarActionButton disabled={busy}>操作<ChevronDown data-icon="inline-end" /></SystemAppTopBarActionButton></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
          {draftView ? <DropdownMenuItem variant="destructive" onSelect={() => onBatch("delete")}>删除草稿</DropdownMenuItem> : <>
          <DropdownMenuItem onSelect={() => onBatch("read")}>标记已读</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("unread")}>标记未读</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("star")}>加星标</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("unstar")}>取消星标</DropdownMenuItem>
          <DropdownMenuSub><DropdownMenuSubTrigger>移动至</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuGroup>{folders.filter(f => f.selectable && f.role !== "drafts").map(folder => <DropdownMenuItem key={folder.id} onSelect={() => onMove(folder.id)}>{folderName(folder)}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuSubContent></DropdownMenuSub>
          <DropdownMenuItem onSelect={() => onBatch("delete")}>移至回收站</DropdownMenuItem><DropdownMenuItem onSelect={() => onBatch("restore")}>恢复到收件箱</DropdownMenuItem>{canPermanentlyDelete && <DropdownMenuItem variant="destructive" onSelect={() => onBatch("permanent")}>永久删除</DropdownMenuItem>}
          </>}
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </> : <><div className="flex-1" />{onSearch && <Hint label="搜索邮件"><SystemAppTopBarActionButton iconOnly aria-label="搜索邮件" onClick={() => setSearching(true)}><Search /></SystemAppTopBarActionButton></Hint>}</>}
    </>}
    {status && <Popover><Hint label={status}><PopoverTrigger asChild><SystemAppTopBarActionButton iconOnly aria-label={status}><Info /></SystemAppTopBarActionButton></PopoverTrigger></Hint><PopoverContent align="end" className="w-64"><p className="text-sm">{status}</p>{canContinue && <Button variant="ghost" className="mt-2" disabled={busy} onClick={onContinue}>继续检索</Button>}</PopoverContent></Popover>}
    {syncStatus && syncStatus.state !== "completed" && <Popover><Hint label={syncLabel}><PopoverTrigger asChild><SystemAppTopBarActionButton aria-label={syncLabel} className="min-w-0 shrink" aria-busy={syncStatus.state === "running"}><SyncIcon className={syncStatus.state === "running" ? "animate-spin motion-reduce:animate-none" : undefined} /><span className="truncate">{syncStatus.label}</span>{syncStatus.count && <span className="tabular-nums">{syncStatus.count}</span>}</SystemAppTopBarActionButton></PopoverTrigger></Hint><PopoverContent align="end" className="w-64 space-y-2 text-sm"><p>{syncStatus.label}</p>{syncStatus.progress && <p className="tabular-nums text-muted-foreground">{syncStatus.progress}</p>}{syncStatus.error && <p className="text-destructive">{syncStatus.error}</p>}</PopoverContent></Popover>}
  </div></TooltipProvider>
}
