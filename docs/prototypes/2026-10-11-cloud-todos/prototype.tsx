import { useEffect, useRef, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { ArrowLeft, AudioLines, Bell, CheckCircle2, ChevronRight, Circle, ClipboardList, Ellipsis, House, ListTodo, Mail, Plus, Terminal, User, HardDrive, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Item, ItemGroup } from "@/components/ui/item"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { cn } from "@/lib/utils"
import { displayedTodos, dueLabel, reminderLabel, reminderOptions, type Platform, type Scenario, type Todo, type Reminder } from "./model"
import { usePrototype, type Prototype } from "./use-prototype"

const filterTabs = [{ id: "pending", label: "未完成" }, { id: "all", label: "全部" }] as const

function PreviewControls({ app }: { app: Prototype }) {
  const hostHasControls = Boolean((globalThis as typeof globalThis & { Tweak?: unknown }).Tweak)
  return <div className="flex flex-wrap items-center justify-between gap-3 py-4">
    <Tabs value={app.platform} onValueChange={value => app.setPlatform(value as Platform)}>
      <TabsList aria-label="预览平台">
        <TabsTrigger value="desktop">桌面端</TabsTrigger>
        <TabsTrigger value="iphone">iPhone</TabsTrigger>
        <TabsTrigger value="ipad">iPad</TabsTrigger>
      </TabsList>
    </Tabs>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{app.platform === "desktop" ? "示例数据" : "iOS 交互示意 · 示例数据"}</span>
      {!hostHasControls && <NativeSelect aria-label="预览状态" value={app.scenario} onChange={event => app.setScenario(event.target.value as Scenario)}>
        <NativeSelectOption value="normal">正常</NativeSelectOption>
        <NativeSelectOption value="signed-out">未登录</NativeSelectOption>
        <NativeSelectOption value="offline">网络失败</NativeSelectOption>
        <NativeSelectOption value="empty">空列表</NativeSelectOption>
        <NativeSelectOption value="notifications-off">通知权限关闭</NativeSelectOption>
      </NativeSelect>}
    </div>
  </div>
}
function StatusView({ app }: { app: Prototype }) {
  if (app.scenario === "signed-out") return <div className="flex min-h-72 flex-col items-center justify-center gap-4 p-6">
    <ListTodo className="size-6 text-muted-foreground" aria-hidden="true" />
    <p>登录后查看待办事项</p><Button onClick={() => app.setScenario("normal")}>登录</Button>
  </div>
  if (app.scenario === "offline") return <div className="flex min-h-72 flex-col items-center justify-center gap-4 p-6">
    <p role="alert">加载失败，检查网络后重试</p><Button onClick={() => app.setScenario("normal")}>重试</Button>
  </div>
  return null
}
function TodoRow({ todo, app }: { todo: Todo; app: Prototype }) {
  const mobile = app.platform !== "desktop"
  const deadline = dueLabel(todo)
  const reminder = reminderLabel(todo)
  return <Item role="listitem" data-todo-id={todo.id} className="flex-nowrap gap-3">
    {mobile ? <button type="button" className="flex size-11 shrink-0 items-center justify-center" aria-label={`${todo.completed ? "恢复" : "完成"}：${todo.title}`} aria-pressed={todo.completed} onClick={() => app.toggle(todo)}>
      {todo.completed ? <CheckCircle2 className="size-5" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
    </button> : <Checkbox checked={todo.completed} aria-label={`${todo.completed ? "恢复" : "完成"}：${todo.title}`} onCheckedChange={() => app.toggle(todo)} />}
    <button type="button" className="flex min-w-0 flex-1 flex-col gap-1 py-2 text-left" onClick={() => app.openEditor(todo)} aria-label={`编辑：${todo.title}`}>
      <span className={cn("break-words", todo.completed && "text-muted-foreground line-through")}>{todo.title}</span>
      {!todo.completed && todo.note && <span className="line-clamp-1 text-sm text-muted-foreground">{todo.note}</span>}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {todo.completed ? <span>已完成</span> : <>{deadline && <span className={deadline.startsWith("已逾期") ? "text-destructive" : undefined}>{deadline}</span>}{reminder && <span className="inline-flex items-center gap-1"><Bell className="size-3.5" aria-hidden="true" />{reminder}</span>}</>}
      </span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`更多：${todo.title}`}><Ellipsis /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => app.openEditor(todo)}>编辑</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => app.toggle(todo)}>{todo.completed ? "恢复为未完成" : "标记完成"}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => app.setDeleting(todo)}>删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Item>
}
function TodoList({ app }: { app: Prototype }) {
  if (app.scenario === "signed-out" || app.scenario === "offline") return <StatusView app={app} />
  const todos = displayedTodos(app.todos, app.filter)
  return <div className="mx-auto w-full max-w-4xl p-3 sm:p-6">
    {app.scenario === "notifications-off" && <p className="mb-4 text-sm" role="status">系统通知未开启，提醒仍会出现在通知列表。</p>}
    {todos.length ? <ItemGroup aria-label="待办事项列表">{todos.map(todo => <TodoRow key={todo.id} todo={todo} app={app} />)}</ItemGroup> : <div className="flex min-h-72 flex-col items-center justify-center gap-4">
      <CheckCircle2 className="size-6 text-muted-foreground" aria-hidden="true" />
      <p>{app.filter === "pending" && app.todos.length ? "没有未完成事项" : "还没有待办事项"}</p>
      <Button onClick={() => app.openEditor()}><Plus />新建事项</Button>
    </div>}
    {app.notice && <div className="mt-4 flex items-center justify-center gap-2 text-sm" role="status" aria-live="polite">{app.notice}{app.undoItem && <Button variant="ghost" onClick={app.undo}><RotateCcw />撤销</Button>}</div>}
  </div>
}
function Desktop({ app }: { app: Prototype }) {
  if (app.home) return <div className="min-h-128 bg-background p-6">
    <h2 className="mb-6 font-medium">应用</h2>
    <Button variant="ghost" onClick={() => app.setHome(false)}><ListTodo />待办事项</Button>
  </div>
  const unavailable = app.scenario === "signed-out" || app.scenario === "offline"
  return <div className="min-h-128 bg-background">
    <EmbeddedSystemAppShell appName="待办事项" onBack={() => app.setHome(true)}>
      <SystemAppWindowShell tabs={filterTabs} value={app.filter} onValueChange={app.setFilter} actions={<SystemAppTopBarActionButton disabled={unavailable} onClick={() => app.openEditor()}><Plus />新建</SystemAppTopBarActionButton>}>
        <TodoList app={app} />
      </SystemAppWindowShell>
    </EmbeddedSystemAppShell>
  </div>
}
function MobileHome({ app }: { app: Prototype }) {
  const entries = [{ title: "待办事项", icon: ListTodo }, { title: "录音", icon: AudioLines }, { title: "云盘", icon: HardDrive }, { title: "站内信", icon: Mail }, { title: "新建会话", icon: Plus }, { title: "剪贴板历史", icon: ClipboardList }]
  return <div className="p-4">
    <h2 className="mb-6 text-lg font-medium">主页</h2>
    <p className="mb-2 text-sm text-muted-foreground">功能</p>
    <ItemGroup aria-label="主页功能清单">{entries.map(entry => <Item key={entry.title} asChild>
      <button type="button" disabled={entry.title !== "待办事项"} onClick={() => app.setHome(false)}>
        <entry.icon className="size-5 text-muted-foreground" aria-hidden="true" /><span className="flex-1 text-left">{entry.title}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>
    </Item>)}</ItemGroup>
  </div>
}
function Mobile({ app }: { app: Prototype }) {
  const unavailable = app.scenario === "signed-out" || app.scenario === "offline"
  return <div className={cn("mx-auto flex min-h-96 flex-col bg-background", app.platform === "iphone" ? "max-w-sm" : "max-w-4xl")}>
    <div className="flex items-center justify-between px-4 py-2 text-sm" aria-label="状态栏"><span>9:41</span><span aria-label="网络和电量">5G · 100%</span></div>
    {app.home ? <MobileHome app={app} /> : <>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" className="inline-flex min-h-11 items-center gap-1" onClick={() => app.setHome(true)}><ArrowLeft className="size-4" aria-hidden="true" />主页</button>
        <h2 className="font-medium">待办事项</h2>
        <button type="button" className="flex size-11 items-center justify-center" aria-label="新建事项" disabled={unavailable} onClick={() => app.openEditor()}><Plus className="size-5" aria-hidden="true" /></button>
      </div>
      <Tabs value={app.filter} onValueChange={app.setFilter} className="px-4"><TabsList className="w-full" aria-label="事项状态"><TabsTrigger value="pending">未完成</TabsTrigger><TabsTrigger value="all">全部</TabsTrigger></TabsList></Tabs>
      <TodoList app={app} />
    </>}
    <div className="mt-auto flex items-center justify-around gap-2 border-t p-3" aria-label="主导航">
      {[{ title: "主页", icon: House }, { title: "终端", icon: Terminal }, { title: "通知", icon: Bell }, { title: "我的", icon: User }].map(tab => <button key={tab.title} type="button" className="flex min-h-11 flex-col items-center justify-center gap-1 text-sm" disabled={tab.title !== "主页"} aria-current={tab.title === "主页" ? "page" : undefined} onClick={() => app.setHome(true)}><tab.icon className="size-5" aria-hidden="true" />{tab.title}</button>)}
    </div>
  </div>
}
function EditorForm({ app }: { app: Prototype }) {
  function submit(event: FormEvent) { event.preventDefault(); app.save() }
  return <form id="todo-editor-form" onSubmit={submit} className="grid gap-4 pt-3">
        <div className="grid gap-2"><Label htmlFor="todo-title">标题</Label><Input id="todo-title" autoFocus value={app.draft.title} aria-invalid={Boolean(app.error && !app.draft.title.trim())} onChange={event => app.setDraft({ ...app.draft, title: event.target.value })} /></div>
        <div className="grid gap-2"><Label htmlFor="todo-note">备注</Label><Textarea id="todo-note" value={app.draft.note} onChange={event => app.setDraft({ ...app.draft, note: event.target.value })} /></div>
        <div className="grid gap-2"><Label htmlFor="todo-due">截止时间</Label><Input id="todo-due" type="datetime-local" value={app.draft.due} onChange={event => app.setDraft({ ...app.draft, due: event.target.value })} /></div>
        <div className="grid gap-2"><Label htmlFor="todo-reminder">提醒</Label><NativeSelect id="todo-reminder" className="w-full" value={app.draft.reminder} onChange={event => app.setDraft({ ...app.draft, reminder: event.target.value as Reminder })}>{reminderOptions.map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></div>
        {app.draft.reminder === "custom" && <div className="grid gap-2"><Label htmlFor="todo-remind-at">提醒时间</Label><Input id="todo-remind-at" type="datetime-local" value={app.draft.customReminder} onChange={event => app.setDraft({ ...app.draft, customReminder: event.target.value })} /></div>}
        {app.error && <p className="text-sm text-destructive" role="alert">{app.error}</p>}
        {app.platform === "desktop" && <DialogFooter><Button type="button" variant="outline" onClick={app.closeEditor}>取消</Button><Button type="submit">{app.editing === "new" ? "添加" : "保存"}</Button></DialogFooter>}
      </form>
}
function Editor({ app }: { app: Prototype }) {
  const title = app.editing === "new" ? "新建事项" : "编辑事项"
  const label = app.editing === "new" ? "添加" : "保存"
  const changed = (open: boolean) => { if (!open) app.closeEditor() }
  if (app.platform === "iphone") return <Sheet open={Boolean(app.editing)} onOpenChange={changed}>
    <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-w-sm" aria-describedby={undefined}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4"><Button variant="ghost" onClick={app.closeEditor}>取消</Button><SheetTitle>{title}</SheetTitle><Button variant="ghost" type="submit" form="todo-editor-form">{label}</Button></div>
      <div className="px-4 pb-6"><EditorForm app={app} /></div>
    </SheetContent>
  </Sheet>
  return <Dialog open={Boolean(app.editing)} onOpenChange={changed}>
    <DialogContent aria-describedby={undefined} showCloseButton={app.platform === "desktop"}>
      {app.platform === "ipad" ? <div className="flex items-center justify-between gap-2"><Button variant="ghost" onClick={app.closeEditor}>取消</Button><DialogTitle>{title}</DialogTitle><Button variant="ghost" type="submit" form="todo-editor-form">{label}</Button></div> : <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>}
      <EditorForm app={app} />
    </DialogContent>
  </Dialog>
}
function DeleteConfirmation({ app }: { app: Prototype }) {
  return <AlertDialog open={Boolean(app.deleting)} onOpenChange={open => { if (!open) app.setDeleting(null) }}><AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>删除事项？</AlertDialogTitle><AlertDialogDescription>{app.deleting?.title}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={app.remove}>删除</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
}
function App() {
  const app = usePrototype()
  const currentApp = useRef(app)
  currentApp.current = app
  useEffect(() => {
    const Tweak = (globalThis as typeof globalThis & { Tweak?: new (options: unknown) => { addSelect: (...args: unknown[]) => void; dispose: () => void } }).Tweak
    const container = document.getElementById("synapse-todo-prototype")
    if (!Tweak || !container) return
    const state = { scenario: app.scenario }
    const tweak = new Tweak({ container, onChange: () => currentApp.current.setScenario(state.scenario) })
    tweak.addSelect(state, "scenario", { label: "预览状态", options: [{ value: "normal", label: "正常" }, { value: "signed-out", label: "未登录" }, { value: "offline", label: "网络失败" }, { value: "empty", label: "空列表" }, { value: "notifications-off", label: "通知权限关闭" }] })
    return () => tweak.dispose()
  }, [])
  return <main className="font-sans text-foreground">
    <PreviewControls app={app} />
    {app.platform === "desktop" ? <Desktop app={app} /> : <Mobile app={app} />}
    <Editor app={app} /><DeleteConfirmation app={app} />
  </main>
}
const container = document.getElementById("synapse-todo-prototype")
if (!container) throw new Error("待办事项原型挂载点缺失")
const appearance = window.matchMedia("(prefers-color-scheme: dark)")
function setAppearance() { document.documentElement.classList.toggle("dark", appearance.matches) }
setAppearance()
appearance.addEventListener("change", setAppearance)
createRoot(container).render(<App />)
