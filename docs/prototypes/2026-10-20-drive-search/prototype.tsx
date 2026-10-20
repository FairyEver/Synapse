import { Fragment } from "react"
import { createRoot } from "react-dom/client"
import { ArrowLeft, Bell, ChevronDown, ChevronRight, CircleAlert, CircleUserRound, FileSearch, FolderOpen, History, RotateCcw, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DriveItemIcon } from "@/modules/drive/drive-item-icon"
import { ModuleContentPanel, ModulePage } from "@/components/module-page"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { DriveToolbarActions } from "@/modules/drive/drive-toolbar-actions"
import { DriveTableColumns, DRIVE_FILE_TABLE_COLUMNS } from "@/modules/drive/drive-table-columns"
import { driveRootSystemEntries } from "@/modules/drive/drive-system-entries"
import { AppShellDock } from "@/app-shell/components/app-shell-dock"
import agentIcon from "@/modules/agent/assets/icon.png"
import driveIcon from "@/modules/drive/assets/icon.png"
import settingsIcon from "@/modules/settings/assets/icon.png"
import workflowIcon from "@/modules/workflow/assets/icon.png"
import terminalIcon from "../../../desktop/app-capabilities/terminal/renderer/assets/icon.png"
import databaseIcon from "@/modules/database/assets/icon.png"
import repositoryIcon from "@/modules/resource-repository/assets/icon.png"
import mailIcon from "@/modules/mail/assets/icon.png"
import launcherIcon from "@/modules/apps/assets/icon.png"
import { cn } from "@/lib/utils"
import { TYPE_LABELS, ancestors, hasFilters, itemPath, modifiedLabel, normalize, termsFor, type Item, type FileType, type Scope, type Sort } from "./model"
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

function SearchInput({ app }: { app: Prototype }) {
  return <form className="w-full min-w-0 sm:w-80" role="search" onSubmit={event => { event.preventDefault(); if (!app.composing) app.submit() }}>
        <InputGroup>
          <InputGroupInput id="file-search" aria-label="搜索文件名或扩展名" ref={app.inputRef} type="text" role="searchbox" autoComplete="off" value={app.draft} placeholder="搜索文件名或扩展名"
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
    </form>
}

function SearchFilters({ app }: { app: Prototype }) {
  return <section aria-label="文件搜索" className="flex flex-col gap-2 px-1">
    <div className="flex flex-wrap items-center gap-2" aria-label="搜索筛选">
      <NativeSelect aria-label="搜索范围" value={app.scope} onChange={event => app.changeScope(event.target.value as Scope)}>
        <NativeSelectOption value="all">整个云盘</NativeSelectOption>
        {app.folder && <NativeSelectOption value="folder">当前文件夹及子文件夹</NativeSelectOption>}
      </NativeSelect>
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
      {app.active && <NativeSelect aria-label="结果排序" value={app.sort} onChange={event => app.changeSort(event.target.value as Sort)}>
        <NativeSelectOption value="relevance">相关度优先</NativeSelectOption><NativeSelectOption value="modified">最近更新优先</NativeSelectOption><NativeSelectOption value="name">名称排序</NativeSelectOption>
      </NativeSelect>}
      <Button variant="ghost" onClick={app.exitSearch}>退出搜索</Button>
    </div>
    {app.focused && !app.draft && !app.active && app.history.length > 0 && <div aria-label="最近搜索" className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><History className="size-3.5" />最近搜索</span>
      {app.history.map(value => <Button key={value} variant="secondary" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => app.submit(value)}>{value}</Button>)}
      <Button variant="ghost" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => app.setHistory([])}>清空记录</Button>
    </div>}
  </section>
}

function Breadcrumbs({ app }: { app: Prototype }) {
  return <nav aria-label="云盘位置" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
    <Button variant="ghost" size="sm" aria-label="根目录" onClick={() => app.navigate(null)}>根目录</Button>
    {ancestors(app.folder).map(folder => <Fragment key={folder.id}><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /><Button variant="ghost" size="sm" onClick={() => app.navigate(folder.id)}>{folder.name}</Button></Fragment>)}
    {app.active && <><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /><span className="font-medium">搜索结果</span><span className="text-xs text-muted-foreground" role="status" aria-live="polite">{app.pending ? "搜索中…" : app.error ? "搜索失败" : `${app.total} 项`}</span></>}
  </nav>
}

function FileRow({ item, app }: { item: Item; app: Prototype }) {
  const folder = item.type === "folder"
  return <TableRow data-item={item.id} className={cn(app.located === item.id && "bg-selected hover:bg-selected")} onClick={() => app.open(item)}>
    <TableCell className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <DriveItemIcon kind={folder ? "folder" : "file"} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="block min-w-0 truncate font-medium select-text cursor-pointer hover:underline" role="button" tabIndex={0} title={item.name}
              onClick={event => { event.stopPropagation(); app.open(item) }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); app.open(item) } }} aria-label={`${folder ? "打开" : "预览"} ${item.name}`}>
              <Highlight text={item.name} query={app.active ? app.query : ""} />
            </span>
            {item.shared && <Badge variant="outline">分享</Badge>}
            {app.located === item.id && <Badge variant="secondary">已定位</Badge>}
          </div>
          {app.active && <Button variant="link" size="xs" className="max-w-full justify-start" title={itemPath(item)} aria-label={`打开所在文件夹 ${itemPath(item)}`} onClick={event => { event.stopPropagation(); app.locate(item) }}>
            <FolderOpen data-icon="inline-start" /><span className="truncate">{itemPath(item)}</span>
          </Button>}
        </div>
      </div>
    </TableCell>
    <TableCell className="truncate text-right tabular-nums text-muted-foreground">{modifiedLabel(item)}</TableCell>
    <TableCell className="text-right"><div className="flex items-center justify-end" onClick={event => event.stopPropagation()}>
      <Button variant="ghost" size="xs" aria-disabled="true">{item.shared ? "取消分享" : "分享"}</Button>
      <Button variant="ghost" size="xs" onClick={() => app.open(item)}>预览</Button>
      <Button variant="ghost" size="xs" aria-disabled="true">删除</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="xs" aria-label={`更多 ${item.name}`}>更多</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => app.locate(item)}>在文件夹中显示</DropdownMenuItem>
          <DropdownMenuItem disabled>下载</DropdownMenuItem><DropdownMenuItem disabled>重命名</DropdownMenuItem><DropdownMenuItem disabled>移动</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>
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
    <ModuleContentPanel>
    {app.pending ? <div role="status" aria-label="正在搜索" className="flex min-h-80 flex-col gap-5 p-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-4"><Skeleton className="size-5" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
      : app.error ? <Empty className="min-h-80" role="alert"><EmptyHeader><EmptyMedia variant="icon"><CircleAlert /></EmptyMedia><EmptyTitle>搜索失败</EmptyTitle><EmptyDescription>连接中断，请重试。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => app.setError(false)}><RotateCcw />重新搜索</Button></EmptyContent></Empty>
      : !app.visible.length ? app.active ? <NoResults app={app} /> : <Empty className="min-h-80"><EmptyHeader><EmptyMedia variant="icon"><FolderOpen /></EmptyMedia><EmptyTitle>文件夹为空</EmptyTitle></EmptyHeader></Empty>
      : <Table className="min-w-160 table-fixed">
        <DriveTableColumns columns={DRIVE_FILE_TABLE_COLUMNS} />
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>名称</TableHead><TableHead className="text-right">更新时间</TableHead><TableHead className="text-right" aria-label="操作" /></TableRow></TableHeader>
        <TableBody>
          {!app.active && driveRootSystemEntries(app.folder).map(entry => <TableRow key={entry.id} data-system-entry={entry.id}>
            <TableCell><div className="flex min-w-0 items-center gap-2"><DriveItemIcon kind={entry.kind === "public_assets" ? "public-assets" : "trash"} /><span className="truncate font-medium">{entry.name}</span></div></TableCell><TableCell className="text-right text-muted-foreground">-</TableCell><TableCell />
          </TableRow>)}
          {app.visible.map(item => <FileRow key={item.id} item={item} app={app} />)}</TableBody>
      </Table>}
    </ModuleContentPanel>
    {!app.pending && !app.error && app.page < app.pages && <div className="flex justify-center"><Button variant="outline" onClick={() => app.setPage(app.page + 1)}>加载更多</Button></div>}
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
  // 非搜索操作只保留实际产品入口，演示不调用真实账号、文件或其他系统 App。
  const contextOnly = () => undefined
  const usage = <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Progress aria-label="云盘容量" className="h-2 w-40 shrink-0" value={2.5} /><span className="shrink-0">124.7 MB / 5 GB</span></div>
  const actions = <DriveToolbarActions rendererActions={[]} syncSnapshot={null} createDisabled={false} uploadDisabled={false} publicLinksDisabled={false} refreshDisabled={false}
    onCreateFolder={contextOnly} onOpenLocalSync={contextOnly} onOpenPublicLinks={contextOnly} onOpenSyncStatus={contextOnly} onRefresh={() => app.setError(false)} onUploadFiles={contextOnly} onUploadFolder={contextOnly}>
    <SystemAppTopBarActionButton aria-label="搜索文件" aria-pressed={app.searchOpen} onClick={() => app.searchOpen ? app.exitSearch() : app.setSearchOpen(true)}><Search data-icon="inline-start" />搜索</SystemAppTopBarActionButton>
  </DriveToolbarActions>
  const dockApps = [
    { id: "agent", name: "Agent", icon: agentIcon }, { id: "drive", name: "云盘", icon: driveIcon }, { id: "settings", name: "设置", icon: settingsIcon },
    { id: "workflow", name: "工作流", icon: workflowIcon }, { id: "terminal", name: "终端", icon: terminalIcon }, { id: "database", name: "数据库", icon: databaseIcon },
    { id: "resource-repository", name: "文件", icon: repositoryIcon }, { id: "mail", name: "站内信", icon: mailIcon }, { id: "launcher", name: "应用", icon: launcherIcon },
  ] as const
  return <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    <div className="flex h-7 shrink-0 items-center border-b px-3 text-xs font-semibold text-muted-foreground">Synapse AI Studio 1.0.77</div>
    <main className="min-h-0 min-w-0 flex-1">
      <EmbeddedSystemAppShell appName="云盘" mode="dock">
        <ModulePage title="云盘" titleAddon={usage} actions={actions} afterContent={<Preview app={app} />}>
          <div className="flex min-h-full flex-col gap-3">
            <div className="flex min-h-8 flex-wrap items-center gap-2 px-1">
              <Breadcrumbs app={app} />
              {app.searchOpen && <SearchInput app={app} />}
              <Button variant="outline" size="sm" aria-disabled="true">已上传 3 项</Button>
            </div>
            {app.searchOpen && <SearchFilters app={app} />}
            {app.returnTo && <div className="flex flex-wrap items-center gap-2 px-1"><Button variant="outline" onClick={app.restoreSearch}><ArrowLeft />返回搜索结果</Button><span className="text-sm text-muted-foreground">{app.returnTo.query || "筛选结果"}</span></div>}
            <Results app={app} />
          </div>
        </ModulePage>
      </EmbeddedSystemAppShell>
    </main>
    <footer className="shrink-0 border-t border-sidebar-border/50">
      <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 px-3">
        <div /><div className="min-w-0 justify-self-center"><AppShellDock apps={dockApps} value="drive" onValueChange={contextOnly} /></div>
        <div className="hidden min-w-0 justify-self-end lg:block"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" aria-disabled="true"><Bell />通知</Button><Button variant="ghost" size="sm" aria-disabled="true"><CircleUserRound />李杨<ChevronDown /></Button></div></div>
      </div>
    </footer>
  </div>
}

createRoot(document.getElementById("root")!).render(<App />)
