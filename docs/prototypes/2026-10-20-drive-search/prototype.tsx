import { Fragment } from "react"
import { createRoot } from "react-dom/client"
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Cloud, FileSearch, FolderOpen, History, Link2, MapPin, Moon, RotateCcw, Search, Sun, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DriveItemIcon } from "@/modules/drive/drive-item-icon"
import { cn } from "@/lib/utils"
import { PAGE_SIZE, TYPE_LABELS, ancestors, hasFilters, itemPath, normalize, termsFor, type Item, type FileType, type Scope, type Sort } from "./model"
import { usePrototype, type Prototype } from "./use-prototype"

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = termsFor(query)
  if (!terms.length) return <>{text}</>
  const normalized = normalize(text)
  // NFKC 长度变化时不猜测位置；匹配仍由模型完成。
  if (normalized.length !== text.length) return <>{text}</>
  const positions = Array.from(text, (_, index) => terms.some(term => {
    let offset = normalized.indexOf(term)
    while (offset >= 0) {
      if (index >= offset && index < offset + term.length) return true
      offset = normalized.indexOf(term, offset + 1)
    }
    return false
  }))
  const chunks: { value: string; match: boolean }[] = []
  Array.from(text).forEach((character, index) => {
    const last = chunks.at(-1)
    if (last && last.match === positions[index]) last.value += character
    else chunks.push({ value: character, match: positions[index] })
  })
  return <>{chunks.map((chunk, index) => chunk.match
    ? <mark key={index} className="rounded-sm bg-secondary text-secondary-foreground font-semibold">{chunk.value}</mark>
    : <Fragment key={index}>{chunk.value}</Fragment>)}</>
}

function PrototypeControls({ app }: { app: Prototype }) {
  return <aside aria-label="原型演示控制" className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3 sm:px-6">
    <div className="flex items-center gap-2 text-sm"><FileSearch className="size-4" /><span className="font-medium">云盘文件搜索</span><Badge variant="outline">交互原型</Badge></div>
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="演示场景" value="choose" onChange={event => app.scenario(event.target.value)}>
        <NativeSelectOption value="choose" disabled>演示场景</NativeSelectOption>
        <NativeSelectOption value="results">全盘搜索</NativeSelectOption><NativeSelectOption value="folder">文件夹内搜索</NativeSelectOption>
        <NativeSelectOption value="empty">无结果</NativeSelectOption><NativeSelectOption value="error">搜索失败</NativeSelectOption>
      </NativeSelect>
      <Button variant="ghost" aria-label="重置示例" onClick={() => app.scenario("reset")}><RotateCcw /><span className="hidden sm:inline">重置</span></Button>
      <Button variant="ghost" size="icon" aria-label={app.dark ? "切换浅色" : "切换深色"} onClick={() => app.setDark(!app.dark)}>{app.dark ? <Sun /> : <Moon />}</Button>
    </div>
  </aside>
}

function SearchToolbar({ app }: { app: Prototype }) {
  return <section aria-label="文件搜索" className="flex flex-col gap-3">
    <form className="flex flex-wrap items-center gap-2" role="search" onSubmit={event => { event.preventDefault(); if (!app.composing) app.submit() }}>
      <Field className="min-w-0 flex-1 basis-64">
        <FieldLabel htmlFor="file-search" className="sr-only">搜索文件名或扩展名</FieldLabel>
        <InputGroup>
          <InputGroupInput id="file-search" ref={app.inputRef} type="text" role="searchbox" autoComplete="off" value={app.draft} placeholder="搜索文件名或扩展名"
            aria-keyshortcuts="Meta+F Control+F" aria-controls="drive-results" aria-busy={app.pending} onChange={event => app.search(event.target.value)}
            onFocus={() => app.setFocused(true)} onBlur={() => app.setFocused(false)}
            onCompositionStart={() => app.setComposing(true)} onCompositionEnd={() => app.setComposing(false)}
            onKeyDown={event => {
              if (event.key === "Escape" && !app.composing) { event.preventDefault(); app.exitSearch() }
              if (event.key === "Enter" && (app.composing || event.nativeEvent.isComposing)) event.preventDefault()
            }} />
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupAddon align="inline-end">
            {app.draft ? <InputGroupButton size="icon-xs" aria-label="清除关键词" onClick={() => { app.search(""); app.submit(""); app.inputRef.current?.focus() }}><X /></InputGroupButton>
              : <InputGroupText className="hidden sm:flex">⌘ F</InputGroupText>}
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <NativeSelect aria-label="搜索范围" value={app.scope} onChange={event => app.changeScope(event.target.value as Scope)}>
        <NativeSelectOption value="all">整个云盘</NativeSelectOption>
        {app.folder && <NativeSelectOption value="folder">当前文件夹及子文件夹</NativeSelectOption>}
      </NativeSelect>
      <Button type="submit">搜索</Button>
      {(app.active || app.pending) && <Button variant="ghost" type="button" onClick={app.exitSearch}>退出搜索</Button>}
    </form>
    <div className="flex flex-wrap items-center gap-2" aria-label="搜索筛选">
      <NativeSelect aria-label="文件类型" value={app.filters.type} onChange={event => app.updateFilter("type", event.target.value)}>
        {(Object.keys(TYPE_LABELS) as FileType[]).map(type => <NativeSelectOption key={type} value={type}>{TYPE_LABELS[type]}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect aria-label="更新时间" value={app.filters.days} onChange={event => app.updateFilter("days", event.target.value)}>
        <NativeSelectOption value="all">不限更新时间</NativeSelectOption><NativeSelectOption value="1">今天</NativeSelectOption>
        <NativeSelectOption value="7">最近 7 天</NativeSelectOption><NativeSelectOption value="30">最近 30 天</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="分享状态" value={app.filters.shared} onChange={event => app.updateFilter("shared", event.target.value)}>
        <NativeSelectOption value="all">全部分享状态</NativeSelectOption><NativeSelectOption value="shared">已分享</NativeSelectOption><NativeSelectOption value="private">未分享</NativeSelectOption>
      </NativeSelect>
      {hasFilters(app.filters) && <Button variant="ghost" onClick={app.clearFilters}>清除筛选</Button>}
    </div>
    {app.focused && !app.draft && !app.active && app.history.length > 0 && <div aria-label="最近搜索" className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><History className="size-3.5" />最近搜索</span>
      {app.history.map(value => <Button key={value} variant="secondary" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => app.submit(value)}>{value}</Button>)}
      <Button variant="ghost" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => app.setHistory([])}>清空记录</Button>
    </div>}
  </section>
}

function Breadcrumbs({ app }: { app: Prototype }) {
  return <nav aria-label="云盘位置" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
    <Button variant="ghost" size="sm" aria-label="根目录" onClick={() => app.navigate(null)}>根目录</Button>
    {ancestors(app.folder).map(folder => <Fragment key={folder.id}><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /><Button variant="ghost" size="sm" onClick={() => app.navigate(folder.id)}>{folder.name}</Button></Fragment>)}
  </nav>
}

function FileRow({ item, app }: { item: Item; app: Prototype }) {
  const folder = item.type === "folder"
  return <TableRow data-item={item.id} className={cn(app.located === item.id && "bg-selected hover:bg-selected")} onClick={() => app.open(item)}>
    <TableCell className="min-w-0 whitespace-normal py-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="pt-2"><DriveItemIcon kind={folder ? "folder" : "file"} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Button variant="ghost" className="min-w-0 max-w-full justify-start" title={item.name} onClick={event => { event.stopPropagation(); app.open(item) }} aria-label={`${folder ? "打开" : "预览"} ${item.name}`}>
              <span className="truncate"><Highlight text={item.name} query={app.active ? app.query : ""} /></span>
            </Button>
            {item.shared && <Badge variant="outline"><Link2 />分享</Badge>}
            {app.located === item.id && <Badge variant="secondary">已定位</Badge>}
          </div>
          {app.active && <Button variant="link" size="xs" className="max-w-full justify-start" title={itemPath(item)} aria-label={`打开所在文件夹 ${itemPath(item)}`} onClick={event => { event.stopPropagation(); app.locate(item) }}>
            <span className="truncate">{itemPath(item)}</span><ArrowUpRight data-icon="inline-end" />
          </Button>}
          <span className="block pl-2.5 text-xs text-muted-foreground sm:hidden">{TYPE_LABELS[item.type]} · {item.modified}</span>
        </div>
      </div>
    </TableCell>
    <TableCell className="hidden text-muted-foreground lg:table-cell">{TYPE_LABELS[item.type]}</TableCell>
    <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{item.size}</TableCell>
    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{item.modified}</TableCell>
    <TableCell className="text-right">{app.active
      ? <Button variant="ghost" size="sm" aria-label={`定位 ${item.name}`} onClick={event => { event.stopPropagation(); app.locate(item) }}><MapPin /><span className="hidden sm:inline">定位</span></Button>
      : <Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); app.open(item) }}>{folder ? "打开" : "预览"}</Button>}
    </TableCell>
  </TableRow>
}

function NoResults({ app }: { app: Prototype }) {
  const filtered = hasFilters(app.filters)
  return <Empty className="min-h-80">
    <EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>未找到匹配的文件</EmptyTitle>
      <EmptyDescription>{filtered ? "尝试清除筛选或更换关键词。" : app.scope === "folder" ? "尝试在整个云盘搜索。" : "尝试缩短文件名或搜索扩展名。"}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent><div className="flex flex-wrap justify-center gap-2">
      {filtered && <Button variant="outline" onClick={app.clearFilters}>清除筛选</Button>}
      {app.scope === "folder" && <Button onClick={() => app.changeScope("all")}>搜索整个云盘</Button>}
      <Button variant="ghost" onClick={() => { app.inputRef.current?.focus(); app.inputRef.current?.select() }}>修改关键词</Button>
    </div></EmptyContent>
  </Empty>
}

function Results({ app }: { app: Prototype }) {
  return <section id="drive-results" aria-label={app.active ? "搜索结果" : "文件列表"} aria-busy={app.pending} className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {app.active ? <><h2 className="text-sm font-medium">搜索结果</h2><span className="text-sm text-muted-foreground" aria-live="polite" role="status">{app.pending ? "搜索中…" : app.error ? "搜索失败" : `${app.total} 项`}</span>
          <Badge variant="secondary">{app.scope === "all" ? "整个云盘" : ancestors(app.folder).at(-1)?.name}</Badge></> : <Breadcrumbs app={app} />}
      </div>
      {app.active && <NativeSelect aria-label="结果排序" value={app.sort} onChange={event => app.changeSort(event.target.value as Sort)}>
        <NativeSelectOption value="relevance">相关度优先</NativeSelectOption><NativeSelectOption value="modified">最近更新优先</NativeSelectOption><NativeSelectOption value="name">名称排序</NativeSelectOption>
      </NativeSelect>}
    </div>
    {app.pending ? <div role="status" aria-label="正在搜索" className="flex min-h-80 flex-col gap-5 p-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-4"><Skeleton className="size-5" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
      : app.error ? <Empty className="min-h-80" role="alert"><EmptyHeader><EmptyMedia variant="icon"><CircleAlert /></EmptyMedia><EmptyTitle>搜索失败</EmptyTitle><EmptyDescription>连接中断，请重试。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => app.setError(false)}><RotateCcw />重新搜索</Button></EmptyContent></Empty>
      : !app.visible.length ? app.active ? <NoResults app={app} /> : <Empty className="min-h-80"><EmptyHeader><EmptyMedia variant="icon"><FolderOpen /></EmptyMedia><EmptyTitle>文件夹为空</EmptyTitle></EmptyHeader></Empty>
      : <Table className="table-fixed" scrollbars="none">
        <TableHeader><TableRow><TableHead>名称</TableHead><TableHead className="hidden w-24 lg:table-cell">类型</TableHead><TableHead className="hidden w-24 text-right md:table-cell">大小</TableHead><TableHead className="hidden w-32 text-right sm:table-cell">更新时间</TableHead><TableHead className="w-16 text-right sm:w-24"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
        <TableBody>{app.visible.map(item => <FileRow key={item.id} item={item} app={app} />)}</TableBody>
      </Table>}
    {!app.pending && !app.error && app.pages > 1 && <nav aria-label="文件列表分页" className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className="text-xs tabular-nums text-muted-foreground">{(app.page - 1) * PAGE_SIZE + 1}–{Math.min(app.page * PAGE_SIZE, app.total)} / {app.total} 项</span>
      <div className="flex items-center gap-2"><Button variant="outline" aria-label="上一页" disabled={app.page === 1} onClick={() => app.setPage(app.page - 1)}><ChevronLeft /></Button>
        <span className="text-sm tabular-nums">{app.page} / {app.pages}</span><Button variant="outline" aria-label="下一页" disabled={app.page === app.pages} onClick={() => app.setPage(app.page + 1)}><ChevronRight /></Button></div>
    </nav>}
  </section>
}

function Preview({ app }: { app: Prototype }) {
  const item = app.preview
  return <Dialog open={Boolean(item)} onOpenChange={open => { if (!open) app.setPreview(null) }}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle className="break-all">{item?.name}</DialogTitle><DialogDescription className="break-all">{item && itemPath(item)}</DialogDescription></DialogHeader>
      {item && <div className="flex flex-col gap-5 py-2">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{TYPE_LABELS[item.type]}</span><span>{item.size}</span><span>更新于 {item.modified}</span></div>
        {item.type === "document" ? <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{item.body ?? `${item.name.replace(/\.[^.]+$/, "")}\n\n产品目标\n让文件查找、查看与定位保持在同一条操作路径中。\n\n验收记录\n名称匹配后保留所在文件夹与更新时间；同名文件通过路径区分。`}</div>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileSearch /></EmptyMedia><EmptyTitle>此文件暂不支持预览</EmptyTitle></EmptyHeader></Empty>}
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => app.setPreview(null)}>关闭预览</Button><Button onClick={() => item && app.locate(item)}><FolderOpen />打开所在文件夹</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function App() {
  const app = usePrototype()
  return <div className="min-h-dvh bg-background text-foreground">
    <PrototypeControls app={app} />
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-base font-semibold"><Cloud className="size-5" />云盘</h1><span className="text-xs tabular-nums text-muted-foreground">124.7 MB / 5 GB</span></header>
      <SearchToolbar app={app} />
      {app.returnTo && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={app.restoreSearch}><ArrowLeft />返回搜索结果</Button><span className="text-sm text-muted-foreground">{app.returnTo.query || "筛选结果"}</span></div>}
      <Results app={app} />
      <Preview app={app} />
    </main>
  </div>
}

createRoot(document.getElementById("drive-prototype")!).render(<App />)
