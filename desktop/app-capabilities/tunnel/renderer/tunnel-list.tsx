import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import type { TunnelMappingDto, TunnelRuntimeStatus } from "@synapse/shared/tunnel-contracts"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
const statuses: Record<TunnelRuntimeStatus, string> = { connecting: "正在连接", running: "运行中", "local-unavailable": "本机服务不可达", offline: "电脑离线", stopped: "已停止", "authorization-required": "待授权", error: "连接失败" }
export function TunnelList({ items, clientId, loading, writingIds, onCopy, onEdit, onDelete, onEnabled }: {
  items: TunnelMappingDto[]; clientId: string; loading: boolean; writingIds: Set<string>
  onCopy(row: TunnelMappingDto): void; onEdit(row: TunnelMappingDto): void; onDelete(row: TunnelMappingDto): void; onEnabled(row: TunnelMappingDto, enabled: boolean): void
}) {
  if (loading && !items.length) return <div role="status" aria-label="正在读取链接" className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
  if (!items.length) return <p className="p-8 text-center text-sm text-muted-foreground">暂无链接</p>
  return <ul className="divide-y divide-border">{items.map(row => {
    const disabled = row.clientInstanceId !== clientId || writingIds.has(row.id)
    return <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60 space-y-1"><p className="break-all font-mono text-sm select-text">{row.url}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>localhost:{row.port}</span><span>{row.deviceName}</span><span role="status">{statuses[row.runtimeStatus]}</span></p></div>
      <div className="flex shrink-0 items-center gap-3"><Switch checked={row.enabled} disabled={disabled} onCheckedChange={enabled => onEnabled(row, enabled)} aria-label={`启用端口 ${row.port}`} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`复制端口 ${row.port} 的链接`} onClick={() => onCopy(row)}><Copy /></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`端口 ${row.port} 的更多操作`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem disabled={disabled} onSelect={() => onEdit(row)}><Pencil />修改端口</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" disabled={disabled} onSelect={() => onDelete(row)}><Trash2 />删除链接</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu></div>
    </li>
  })}</ul>
}
