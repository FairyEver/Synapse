import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ArrowLeftRight, ArrowUp, Check, ChevronRight, CircleAlert, Cloud, Copy, FileText, FolderOpen, Link2, LockKeyhole, MinusCircle, Moon, Pause, Play, RotateCcw, Settings2, Sun, Wifi, WifiOff, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { DriveItemIcon } from "@/modules/drive/drive-item-icon"
import { cn } from "@/lib/utils"
import { cloudPath, localPath, shareAccess, syncLabel, syncStatus, type Binding, type Item } from "./model"
import { usePrototype, type Prototype } from "./use-prototype"

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-3">
    <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd>
  </div>
}
function PopupHeading({ title, icon, app }: { title: string; icon: ReactNode; app: Prototype }) {
  return <div className="flex items-center justify-between gap-2">
    <h2 className="flex items-center gap-2 font-medium">{icon}{title}</h2>
    <Button size="icon-xs" variant="ghost" aria-label="关闭详情" onClick={() => app.setPopover(null)}><X /></Button>
  </div>
}
function CopyButton({ value, app, label = "复制路径" }: { value: string; app: Prototype; label?: string }) {
  return <Button variant="outline" onClick={() => void app.copy(value, label === "复制链接" ? "已复制示例链接" : "已复制路径")}><Copy />{label}</Button>
}
function shareUrl(item: Item) { return `https://example.invalid/share/demo-${item.id}` }

function ShareFacts({ item }: { item: Item }) {
  if (!item.share) return null
  return <dl className="grid gap-3 text-sm leading-5">
    <Info label="访问权限">{shareAccess(item.share)}</Info>
    <Info label="有效期">{item.share.expired ? <span className="text-destructive">已过期 · {item.share.expires}</span> : item.share.expires ?? "永久有效"}</Info>
    <Info label="密码保护"><span className="flex items-center gap-1.5">{item.share.password && <LockKeyhole className="size-3.5" />}{item.share.password ? "已开启" : "未开启"}</span></Info>
  </dl>
}
function ShareTag({ item, app }: { item: Item; app: Prototype }) {
  if (!item.share) return null
  const key = `share:${item.id}`
  const expired = item.share.expired
  return <Popover open={app.popover === key} onOpenChange={open => app.setPopover(open ? key : null)}>
    <PopoverTrigger asChild>
      <Badge asChild variant={expired ? "destructive" : "outline"}>
        <button type="button" data-tag="share" className="cursor-pointer hover:bg-muted" aria-label={`${item.name}：${expired ? "分享已过期" : "已分享"}，查看分享详情`} onClick={event => event.stopPropagation()}><Link2 />{expired ? "分享已过期" : "已分享"}</button>
      </Badge>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} collisionPadding={16} className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4 motion-reduce:animate-none" aria-label={`${item.name}的分享详情`} onClick={event => event.stopPropagation()} onCloseAutoFocus={event => { if (app.popover !== null || app.panel !== null) event.preventDefault() }}>
      <PopupHeading title="分享详情" icon={<Link2 className="size-4" />} app={app} />
      <ShareFacts item={item} />
      {expired && <p className="text-sm text-destructive">链接已失效，延长有效期后恢复访问。</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {expired ? <Button onClick={() => app.showPanel({ kind: "share", itemId: item.id })}>延长有效期</Button> : <CopyButton value={shareUrl(item)} app={app} label="复制链接" />}
        <Button variant="ghost" onClick={() => app.showPanel({ kind: "share", itemId: item.id })}><Settings2 />分享设置</Button>
      </div>
    </PopoverContent>
  </Popover>
}

function SyncIcon({ item, binding }: { item: Item; binding: Binding }) {
  const Icon = item.excluded ? MinusCircle : item.contains ? FolderOpen : binding.state === "conflict" ? CircleAlert : binding.state === "paused" ? Pause : binding.state === "offline" ? WifiOff : binding.state === "uploading" ? ArrowUp : ArrowLeftRight
  return <Icon aria-hidden="true" />
}
function SyncFacts({ item, binding, app }: { item: Item; binding: Binding; app: Prototype }) {
  const root = app.items.find(candidate => candidate.id === binding.root)!
  if (item.contains) return <>
    <p className="text-sm text-muted-foreground">仅部分子项与本机同步。</p>
    <Button variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left" onClick={() => app.showPanel({ kind: "sync", itemId: root.id })}><FileText /><span className="min-w-0 break-words">{root.name}</span><ChevronRight /></Button>
  </>
  return <>
    <dl className="grid gap-3 text-sm leading-5">
      {!item.excluded && <Info label="同步方式"><span className="flex items-center gap-2">本机 <ArrowLeftRight className="size-3.5" aria-label="双向同步" /> 云盘</span></Info>}
      <Info label="同步来源">{item.inherited ? <span>随文件夹 <span className="font-medium">{root.name}</span></span> : item.folder ? "此文件夹" : "此文件"}</Info>
      {item.excluded ? <Info label="排除规则"><code>{item.excluded}</code></Info> : <>
        <Info label="本地位置"><span className="break-all">{localPath(item, binding, app.items)}</span></Info>
        <Info label="当前状态"><span className={cn("flex items-center gap-1.5", binding.state === "conflict" && "text-destructive")}>{binding.state === "active" && <Check className="size-3.5" />}{syncStatus(binding)}</span></Info>
        <Info label="最近同步">{binding.lastSync}</Info>
      </>}
    </dl>
    {binding.state === "uploading" && !item.excluded && <Progress value={64} aria-label="上传进度 64%" />}
    <p className={cn("text-sm leading-5", binding.state === "conflict" && !item.excluded ? "text-destructive" : "text-muted-foreground")}>
      {item.excluded ? "此项的修改和删除不会同步到另一端。"
        : binding.state === "conflict" ? "此文件暂停同步，处理冲突后继续。"
        : binding.state === "paused" ? "暂停期间不自动同步，恢复后核对两端变化。"
        : binding.state === "offline" ? "连接恢复后继续核对两端变化。"
        : item.folder ? "范围内文件的修改和删除会双向同步。" : "修改会双向同步。两端都有改动时需处理冲突。"}
    </p>
  </>
}
function SyncTag({ item, app }: { item: Item; app: Prototype }) {
  const binding = app.bindingFor(item)
  if (!binding) return null
  const key = `sync:${item.id}`
  const label = syncLabel(item, binding)
  return <Popover open={app.popover === key} onOpenChange={open => app.setPopover(open ? key : null)}>
    <PopoverTrigger asChild><Badge asChild variant={binding.state === "conflict" && !item.excluded && !item.contains ? "destructive" : item.excluded || item.contains ? "outline" : "secondary"}>
      <button type="button" data-tag="sync" className="cursor-pointer hover:bg-muted" aria-label={`${item.name}：${label}，查看同步详情`} onClick={event => event.stopPropagation()}><SyncIcon item={item} binding={binding} />{label}</button>
    </Badge></PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} collisionPadding={16} className="w-96 max-w-[calc(100vw-2rem)] gap-4 p-4 motion-reduce:animate-none" aria-label={`${item.name}的同步详情`} onClick={event => event.stopPropagation()} onCloseAutoFocus={event => { if (app.popover !== null || app.panel !== null) event.preventDefault() }}>
      <PopupHeading title={item.contains ? "包含的同步项" : item.excluded ? "已排除同步" : "本机同步"} icon={<ArrowLeftRight className="size-4" />} app={app} />
      <SyncFacts item={item} binding={binding} app={app} />
      {!item.contains && <div className="flex items-center justify-between gap-2 pt-1">
        {item.excluded ? <Button variant="outline" onClick={() => app.showPanel({ kind: "sync", itemId: binding.root })}>查看排除规则</Button>
          : <CopyButton value={localPath(item, binding, app.items)} app={app} />}
        <Button variant={binding.state === "conflict" && !item.excluded ? "default" : "ghost"} onClick={() => app.showPanel({ kind: "sync", itemId: binding.root })}>{binding.state === "conflict" && !item.excluded ? "处理冲突" : item.inherited ? "管理文件夹同步" : "管理同步"}</Button>
      </div>}
    </PopoverContent>
  </Popover>
}

function FileRow({ item, app }: { item: Item; app: Prototype }) {
  return <TableRow data-item={item.id} className={cn("motion-reduce:transition-none", item.folder && "cursor-pointer")} onClick={item.folder ? () => app.openFolder(item.id) : undefined}>
    <TableCell className="px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <DriveItemIcon kind={item.folder ? "folder" : "file"} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center">
          <button type="button" className="min-w-0 max-w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={item.name} onClick={event => { event.stopPropagation(); app.openItem(item) }}>{item.name}</button>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5 empty:hidden sm:flex-nowrap"><ShareTag item={item} app={app} /><SyncTag item={item} app={app} /></div>
        </div>
      </div>
    </TableCell>
    <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">{item.updated}</TableCell>
    <TableCell className="px-4 text-right"><Button variant="ghost" size="sm" aria-label={`${item.folder ? "打开" : "预览"}${item.name}`} onClick={event => { event.stopPropagation(); app.openItem(item) }}>{item.folder ? "打开" : "预览"}</Button></TableCell>
  </TableRow>
}

function SharePanel({ item, app }: { item: Item; app: Prototype }) {
  if (!item.share) return null
  return <>
    <ShareFacts item={item} />
    {!item.share.expired && <Input readOnly aria-label="示例分享链接" value={shareUrl(item)} onFocus={event => event.target.select()} />}
    <DialogFooter>
      <Button variant="destructive" disabled={!app.online} onClick={() => app.setConfirm({ kind: "share", id: item.id })}>关闭分享</Button>
      {item.share.expired ? <Button disabled={!app.online} onClick={() => app.renewShare(item)}>延长至 10 月 23 日</Button> : <CopyButton value={shareUrl(item)} app={app} label="复制链接" />}
    </DialogFooter>
  </>
}
function SyncPanel({ item, app }: { item: Item; app: Prototype }) {
  const binding = app.bindingFor(item)
  if (!binding) return <p className="text-sm text-muted-foreground">本机未设置同步。</p>
  return <>
    <SyncFacts item={item} binding={binding} app={app} />
    {item.folder && <div className="grid gap-2 text-sm"><h3 className="font-medium">排除规则</h3><p className="text-muted-foreground">.git/、node_modules/、dist/、*.log</p></div>}
    {binding.state === "conflict" && <div className="grid gap-2 text-sm">
      <h3 className="font-medium">待处理文件</h3><p className="break-words">{item.name}</p>
      <dl className="grid gap-2"><Info label="本机版本">今天 14:25 修改 · 18 KB</Info><Info label="云盘版本">今天 14:28 修改 · 21 KB</Info></dl>
      <Button disabled={!app.online} onClick={() => app.resolveConflict(binding)}>保留两个版本</Button>
    </div>}
    <DialogFooter>
      <Button variant="destructive" disabled={!app.online} onClick={() => app.setConfirm({ kind: "sync", id: binding.id })}>移除同步</Button>
      {binding.state !== "conflict" && <Button variant="outline" disabled={!app.online} onClick={() => app.togglePause(binding)}>{binding.state === "paused" ? <Play /> : <Pause />}{binding.state === "paused" ? "继续同步" : "暂停同步"}</Button>}
    </DialogFooter>
  </>
}
function Panels({ app }: { app: Prototype }) {
  const panel = app.panel
  const item = panel && "itemId" in panel ? app.items.find(candidate => candidate.id === panel.itemId) : null
  const title = panel?.kind === "center" ? "本机同步" : panel?.kind === "share" ? "分享设置" : panel?.kind === "sync" ? "管理同步" : "文件预览"
  const confirmRoot = app.confirm?.kind === "sync" ? app.items.find(candidate => candidate.id === app.bindings.find(binding => binding.id === app.confirm?.id)?.root) : null
  return <>
    <Dialog open={!!panel} onOpenChange={open => { if (!open) app.setPanel(null) }}>
      <DialogContent className="gap-5 sm:max-w-lg max-h-[85dvh] overflow-y-auto motion-reduce:animate-none">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="break-all">{item?.name ?? "与这台电脑建立的同步关系"}</DialogDescription></DialogHeader>
        {panel?.kind === "share" && item && <SharePanel item={item} app={app} />}
        {panel?.kind === "sync" && item && <SyncPanel item={item} app={app} />}
        {panel?.kind === "preview" && item && <>
          <dl className="grid gap-3 text-sm"><Info label="云盘位置">{cloudPath(item, app.items)}</Info><Info label="分享">{item.share ? item.share.expired ? "已过期" : "已分享" : "未分享"}</Info><Info label="本机同步">{app.bindingFor(item) ? syncLabel(item, app.bindingFor(item)!) : "未设置"}</Info></dl>
          <p className="text-sm text-muted-foreground">示例文件，无正文内容。</p>
        </>}
        {panel?.kind === "center" && <div className="grid gap-2">{app.bindings.map(binding => {
          const root = app.items.find(candidate => candidate.id === binding.root)!
          return <Button key={binding.id} variant="ghost" className="h-auto justify-start whitespace-normal py-3 text-left" onClick={() => app.showPanel({ kind: "sync", itemId: root.id })}>
            <DriveItemIcon kind={root.folder ? "folder" : "file"} /><span className="min-w-0 flex-1 truncate">{root.name}</span><Badge variant={binding.state === "conflict" ? "destructive" : "secondary"}>{syncStatus(app.bindingFor(root)!)}</Badge>
          </Button>
        })}{!app.bindings.length && <p className="text-sm text-muted-foreground">本机未设置同步。</p>}</div>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!app.confirm} onOpenChange={open => { if (!open) app.setConfirm(null) }}>
      <AlertDialogContent className="motion-reduce:animate-none"><AlertDialogHeader>
        <AlertDialogTitle>{app.confirm?.kind === "share" ? "关闭分享？" : "移除同步关系？"}</AlertDialogTitle>
        <AlertDialogDescription>{app.confirm?.kind === "share" ? "原分享链接将无法访问。云盘文件保留。" : confirmRoot?.folder ? `停止「${confirmRoot.name}」及其范围内所有子项的同步，两端文件均保留。` : "停止此文件的双向同步，两端文件均保留。"}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!app.online} onClick={app.removeConfirmed}>{app.confirm?.kind === "share" ? "关闭分享" : "移除同步"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <Dialog open={app.copyFallback !== null} onOpenChange={open => { if (!open) app.setCopyFallback(null) }}>
      <DialogContent><DialogHeader><DialogTitle>手动复制</DialogTitle><DialogDescription>浏览器未允许自动复制，请复制下方内容。</DialogDescription></DialogHeader><Input aria-label="待复制内容" readOnly value={app.copyFallback ?? ""} onFocus={event => event.target.select()} autoFocus /></DialogContent>
    </Dialog>
  </>
}

function PrototypeApp() {
  const app = usePrototype()
  return <main className="min-h-dvh bg-surface font-sans text-foreground antialiased">
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2 sm:px-6">
      <div className="flex items-center gap-3"><Cloud className="size-5" /><span className="font-semibold">Synapse</span><span className="text-muted-foreground">/</span><h1 className="text-sm font-medium">云盘</h1><Badge variant="secondary">交互原型</Badge></div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" aria-pressed={!app.online} onClick={() => { app.setOnline(!app.online); app.setPopover(null) }}>{app.online ? <Wifi /> : <WifiOff />}{app.online ? "在线" : "离线"}</Button>
        <Button variant="ghost" onClick={app.reset}><RotateCcw />重置示例</Button>
        <Button variant="ghost" size="icon" aria-label={app.dark ? "切换浅色" : "切换深色"} onClick={() => app.setDark(!app.dark)}>{app.dark ? <Sun /> : <Moon />}</Button>
      </div>
    </header>
    <div className="flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3"><Progress value={2.4} className="w-20 sm:w-36" aria-label="已使用 124.2 MB，共 5 GB" /><span className="text-xs text-muted-foreground tabular-nums">124.2 MB / 5 GB</span></div>
      <Button variant="ghost" onClick={() => app.showPanel({ kind: "center" })}><ArrowLeftRight />同步</Button>
    </div>
    <section className="px-3 py-5 sm:px-5">
      <nav aria-label="云盘路径" className="mb-4 flex min-h-8 flex-wrap items-center gap-1">
        <Button variant="ghost" aria-current={!app.folder ? "page" : undefined} onClick={() => app.openFolder(null)}>根目录</Button>
        {app.breadcrumbs.map(crumb => <span key={crumb.id} className="flex min-w-0 items-center gap-1"><ChevronRight className="size-4 text-muted-foreground" /><Button variant="ghost" className="max-w-48 truncate" aria-current={crumb.id === app.folderId ? "page" : undefined} onClick={() => app.openFolder(crumb.id)}>{crumb.name}</Button></span>)}
      </nav>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <Table className="table-fixed" scrollbars="none"><colgroup><col /><col className="hidden w-32 md:table-column" /><col className="w-20 sm:w-24" /></colgroup>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="px-4">名称</TableHead><TableHead className="hidden text-right md:table-cell">更新时间</TableHead><TableHead className="px-4 text-right"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
          <TableBody>{app.rows.map(item => <FileRow key={item.id} item={item} app={app} />)}</TableBody>
        </Table>
      </div>
      <p className="mt-4 px-1 text-xs text-muted-foreground">示例数据 · 点击文件名后的标签查看详情</p>
    </section>
    <Panels app={app} />
    {app.notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background">{app.notice}</div>}
  </main>
}

createRoot(document.getElementById("drive-prototype")!).render(<PrototypeApp />)
