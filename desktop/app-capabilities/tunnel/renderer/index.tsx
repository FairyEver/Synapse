import { useState } from "react"
import { RefreshCw } from "lucide-react"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
import { useAccount } from "@/app-shell/account"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useTunnels } from "./use-tunnels"
import { TunnelPortDialog } from "./tunnel-port-dialog"
import { TunnelList } from "./tunnel-list"
function TunnelContent() {
  const tunnels = useTunnels(), [filter, setFilter] = useState("current")
  const [editing, setEditing] = useState<TunnelMappingDto | "new" | null>(null), [deleting, setDeleting] = useState<TunnelMappingDto | null>(null)
  const shown = tunnels.items.filter(row => filter === "all" || row.clientInstanceId === tunnels.clientId)
  const editingRow = editing && editing !== "new" ? editing : undefined
  return <SystemAppWindowShell left={<span className="text-sm font-semibold">内网穿透</span>} actions={<><SystemAppTopBarActionButton iconOnly aria-label="刷新链接" tooltip="刷新链接" disabled={tunnels.loading} onClick={() => { void tunnels.refresh() }}><RefreshCw /></SystemAppTopBarActionButton><Button type="button" onClick={() => setEditing("new")}>申请链接</Button></>}>
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 p-3"><NativeSelect aria-label="电脑范围" value={filter} onChange={event => setFilter(event.currentTarget.value)}><NativeSelectOption value="current">当前电脑</NativeSelectOption><NativeSelectOption value="all">全部电脑</NativeSelectOption></NativeSelect></div>
      {tunnels.failure && !editing && !deleting && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{tunnels.failure}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto"><TunnelList items={shown} clientId={tunnels.clientId} loading={tunnels.loading} writingIds={tunnels.writingIds} onCopy={row => { void tunnels.copy(row) }} onEdit={setEditing} onDelete={setDeleting} onEnabled={(row, enabled) => { void tunnels.setEnabled(row, enabled) }} />
        {tunnels.nextOffset !== null && <div className="p-4"><Button type="button" variant="outline" disabled={tunnels.loading} onClick={() => { void tunnels.refresh(tunnels.nextOffset!) }}>加载更多</Button></div>}</div>
    </div>
    {editing && <TunnelPortDialog key={editingRow?.id ?? "new"} port={editingRow?.port} pending={tunnels.writingIds.has(editingRow?.id ?? "create")} failure={tunnels.failure} onClose={() => setEditing(null)} onSave={(port, requestId) => editingRow ? tunnels.update(editingRow, port) : tunnels.create(port, requestId)} />}
    {deleting && <Dialog open onOpenChange={open => { if (!open && !tunnels.writingIds.has(deleting.id)) setDeleting(null) }}><DialogContent><DialogHeader><DialogTitle>删除链接？</DialogTitle><DialogDescription className="break-all">{deleting.url} 将永久停用。</DialogDescription></DialogHeader>{tunnels.failure && <p role="alert" className="text-sm text-destructive">{tunnels.failure}</p>}<DialogFooter><Button type="button" variant="outline" disabled={tunnels.writingIds.has(deleting.id)} onClick={() => setDeleting(null)}>取消</Button><Button type="button" variant="destructive" disabled={tunnels.writingIds.has(deleting.id)} onClick={() => { void tunnels.remove(deleting).then(done => { if (done) setDeleting(null) }) }}>删除链接</Button></DialogFooter></DialogContent></Dialog>}
  </SystemAppWindowShell>
}
export function TunnelModule() {
  const { state, isLoading, startLogin } = useAccount()
  if (state.status === "authenticated" && !isLoading) return <TunnelContent key={state.profile.user.id} />
  return <SystemAppWindowShell left={<span className="text-sm font-semibold">内网穿透</span>}><div className="flex h-full items-center justify-center gap-3 p-4 text-sm text-muted-foreground"><p role="status">{isLoading || state.status === "authenticating" ? "正在读取账号…" : "登录后管理链接"}</p>{!isLoading && state.status !== "authenticating" && <Button type="button" onClick={() => { void startLogin() }}>登录</Button>}</div></SystemAppWindowShell>
}
