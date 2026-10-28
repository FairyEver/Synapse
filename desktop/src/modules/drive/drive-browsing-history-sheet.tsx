import { useRef, useState } from "react"
import { AlertCircle, File, FileText, Folder, Globe, History, LoaderCircle, Search, X } from "lucide-react"
import type { DriveBrowsingHistoryEntryDto, DriveBrowsingHistoryKind } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
import { useDriveBrowsingHistory } from "./use-drive-browsing-history"
import { DriveSearchHighlight } from "./drive-search-highlight"

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
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const groups = groupHistory(history.items)
  const filtered = Boolean(history.query.trim() || history.kind !== "all")
  function changeOpen(value: boolean) { setConfirmation(null); onOpenChange(value) }
  function clearQuery() { history.setQuery(""); inputRef.current?.focus() }
  function resetSearch() { history.setKind("all"); clearQuery() }
  return (
    <Sheet open={open && Boolean(accountId)} onOpenChange={changeOpen}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus() }}>
        <SheetHeader><SheetTitle>浏览历史</SheetTitle></SheetHeader>
        <div role="search" aria-label="浏览历史搜索" className="flex min-w-0 items-center gap-2 px-4">
          <InputGroup className="flex-1">
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput ref={inputRef} role="searchbox" aria-controls="drive-browsing-history-results" autoComplete="off" disabled={history.clearing} maxLength={500} aria-label="搜索浏览历史" placeholder="搜索标题、链接或作者" value={history.query} onChange={event => history.setQuery(event.target.value)} onCompositionStart={() => history.setComposing(true)} onCompositionEnd={() => history.setComposing(false)} />
            {history.query && <InputGroupAddon align="inline-end"><InputGroupButton disabled={history.clearing} aria-label="清除关键词" size="icon-xs" onClick={clearQuery}><X /></InputGroupButton></InputGroupAddon>}
          </InputGroup>
          <NativeSelect className="shrink-0" disabled={history.clearing} aria-label="历史类型" value={history.kind} onChange={event => history.setKind(event.target.value as DriveBrowsingHistoryKind | "all")}>
            <NativeSelectOption value="all">全部类型</NativeSelectOption><NativeSelectOption value="web">网页</NativeSelectOption><NativeSelectOption value="document">文档</NativeSelectOption><NativeSelectOption value="folder">文件夹</NativeSelectOption><NativeSelectOption value="other">其他</NativeSelectOption>
          </NativeSelect>
        </div>
        <div id="drive-browsing-history-results" className="min-h-0 flex-1 overflow-y-auto" aria-label="浏览记录" aria-busy={history.loading || history.loadingMore}>
          <div className="flex min-h-full flex-col px-4 py-2">
          {history.error && history.items.length > 0 && <div role="alert" className="flex items-center gap-3 py-3"><AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" /><p className="min-w-0 flex-1 break-words text-destructive">{history.error}</p><Button variant="outline" disabled={history.clearing} onClick={() => { void history.retry() }}>重试</Button></div>}
          {history.loading ? <HistoryLoading /> : <>
            {groups.map(group => <section key={group.date} aria-label={group.label}>
              <h3 className="py-3 text-xs font-medium text-muted-foreground">{group.label}</h3>
              <ul className="-mx-2.5">{group.items.map(item => {
                const Icon = icons[item.kind]
                return <li key={item.id}><Button variant="ghost" aria-label={`打开 ${item.title}`} aria-description={item.author} className="h-auto min-h-11 w-full justify-start gap-3 py-2.5" onClick={() => { void history.openEntry(item) }}><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-left" title={item.title}><DriveSearchHighlight text={item.title} query={history.query} /></span><span className="w-20 shrink-0 truncate text-left font-normal text-muted-foreground" title={item.author}><DriveSearchHighlight text={item.author} query={history.query} /></span></Button></li>
              })}</ul>
            </section>)}
            {history.items.length === 0 && <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">{history.error ? <AlertCircle /> : filtered ? <Search /> : <History />}</EmptyMedia>
                <EmptyTitle>{history.error ? "加载失败" : filtered ? "没有匹配的历史" : "暂无浏览历史"}</EmptyTitle>
                {history.error && <EmptyDescription role="alert">{history.error}</EmptyDescription>}
              </EmptyHeader>
              {(history.error || filtered) && <EmptyContent>{history.error
                ? <Button variant="outline" disabled={history.clearing} onClick={() => { void history.retry() }}>重试</Button>
                : <Button variant="outline" disabled={history.clearing} onClick={resetSearch}>清除搜索与筛选</Button>}
              </EmptyContent>}
            </Empty>}
            {history.hasMore && <div className="flex justify-center py-4"><Button variant="outline" disabled={history.loadingMore || history.clearing} onClick={() => { void history.loadMore() }}>{history.loadingMore && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}{history.loadingMore ? "加载中…" : "加载更多"}</Button></div>}
          </>}
          </div>
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t px-4 py-3"><span className="text-xs text-muted-foreground">仅本人可见</span><Button variant="ghost" disabled={history.loading || history.clearing || (!filtered && history.items.length === 0)} onClick={() => setConfirmation(accountId)}>{history.clearing ? "清空中…" : "清空历史"}</Button></SheetFooter>
        <AlertDialog open={open && confirmation !== null && confirmation === accountId} onOpenChange={value => { if (!value) setConfirmation(null) }}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>清空全部浏览历史？</AlertDialogTitle><AlertDialogDescription>仅清除浏览记录，不影响原文件和分享链接。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={history.clearing} onClick={() => { setConfirmation(null); void history.clearAll() }}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

function HistoryLoading() {
  return <div role="status" aria-label="加载浏览历史">
    <span className="sr-only">加载中…</span>
    <div aria-hidden="true" className="py-3">
      <Skeleton className="mb-3 h-3 w-10 motion-reduce:animate-none" />
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex h-11 items-center gap-3">
        <Skeleton className="size-4 shrink-0 motion-reduce:animate-none" />
        <Skeleton className="h-4 flex-1 motion-reduce:animate-none" />
        <Skeleton className="h-3 w-20 shrink-0 motion-reduce:animate-none" />
      </div>)}
    </div>
  </div>
}
