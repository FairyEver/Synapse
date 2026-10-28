import { useState } from "react"
import { File, FileText, Folder, Globe, Search } from "lucide-react"
import type { DriveBrowsingHistoryEntryDto, DriveBrowsingHistoryKind } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
import { useDriveBrowsingHistory } from "./use-drive-browsing-history"

const icons = { web: Globe, document: FileText, folder: Folder, other: File }
function groupHistory(items: readonly DriveBrowsingHistoryEntryDto[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const groups: { date: string; label: string; items: DriveBrowsingHistoryEntryDto[] }[] = []
  for (const item of items) {
    const date = new Date(item.visitedAt); date.setHours(0, 0, 0, 0)
    const key = date.toDateString()
    let group = groups.at(-1)
    if (!group || group.date !== key) {
      group = { date: key, label: date.getTime() === today.getTime() ? "今天" : date.getTime() === yesterday.getTime() ? "昨天" : date.toLocaleDateString("zh-CN"), items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
export function DriveBrowsingHistorySheet({ open, accountId, onOpenChange }: { open: boolean; accountId: string | null; onOpenChange: (open: boolean) => void }) {
  const history = useDriveBrowsingHistory({ open, accountId })
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const groups = groupHistory(history.items)
  function changeOpen(value: boolean) { setConfirmation(null); onOpenChange(value) }
  return (
    <Sheet open={open && Boolean(accountId)} onOpenChange={changeOpen}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]" aria-describedby={undefined}>
        <SheetHeader><SheetTitle>浏览历史</SheetTitle></SheetHeader>
        <div className="flex items-center gap-2 px-4">
          <InputGroup>
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput disabled={history.clearing} maxLength={500} aria-label="搜索浏览历史" placeholder="搜索标题、链接或作者" value={history.query} onChange={event => history.setQuery(event.target.value)} onCompositionStart={() => history.setComposing(true)} onCompositionEnd={() => history.setComposing(false)} />
          </InputGroup>
          <NativeSelect disabled={history.clearing} aria-label="历史类型" value={history.kind} onChange={event => history.setKind(event.target.value as DriveBrowsingHistoryKind | "all")}>
            <NativeSelectOption value="all">全部类型</NativeSelectOption><NativeSelectOption value="web">网页</NativeSelectOption><NativeSelectOption value="document">文档</NativeSelectOption><NativeSelectOption value="folder">文件夹</NativeSelectOption><NativeSelectOption value="other">其他</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2" aria-busy={history.loading || history.loadingMore}>
          {history.error && <div role="alert" className="flex items-center justify-between gap-2 py-4"><p className="text-destructive">{history.error}</p><Button variant="outline" disabled={history.clearing} onClick={() => { void history.retry() }}>重试</Button></div>}
          {history.loading ? <p className="py-8 text-center text-muted-foreground" role="status">加载中…</p> : <>
            {groups.map(group => <section key={group.date} aria-label={group.label}>
              <h3 className="py-3 text-xs font-medium text-muted-foreground">{group.label}</h3>
              <ul>{group.items.map(item => {
                const Icon = icons[item.kind]
                return <li key={item.id}><Button variant="ghost" aria-label={`打开 ${item.title}`} className="h-auto w-full justify-start gap-3 py-3" onClick={() => { void history.openEntry(item) }}><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-left">{item.title}</span><span className="max-w-32 truncate text-muted-foreground">{item.author}</span></Button></li>
              })}</ul>
            </section>)}
            {!history.error && history.items.length === 0 && <p className="py-8 text-center text-muted-foreground">{history.query.trim() || history.kind !== "all" ? "没有匹配的历史" : "暂无浏览历史"}</p>}
            {history.hasMore && <div className="flex justify-center py-4"><Button variant="outline" disabled={history.loadingMore || history.clearing} onClick={() => { void history.loadMore() }}>{history.loadingMore ? "加载中…" : "加载更多"}</Button></div>}
          </>}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t px-4 py-3"><span className="text-xs text-muted-foreground">仅本人可见</span><Button variant="ghost" disabled={history.loading || history.clearing} onClick={() => setConfirmation(accountId)}>{history.clearing ? "清空中…" : "清空历史"}</Button></SheetFooter>
        <AlertDialog open={open && confirmation !== null && confirmation === accountId} onOpenChange={value => { if (!value) setConfirmation(null) }}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>清空全部浏览历史？</AlertDialogTitle><AlertDialogDescription>仅清除浏览记录，不影响原文件和分享链接。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={history.clearing} onClick={() => { setConfirmation(null); void history.clearAll() }}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
