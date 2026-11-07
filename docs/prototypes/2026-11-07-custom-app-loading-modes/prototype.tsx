import { useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  ExternalLink,
  Globe2,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Mail,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  PanelTop,
  Plus,
  RotateCw,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  Timer,
  UserRound,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SystemAppTopBar,
  SystemAppTopBarActionButton,
} from "@/modules/apps/components/system-app-top-bar"
import { cn } from "@/lib/utils"

type OpeningMode = "iframe" | "window"
type PrototypeScene = "launcher" | "embedded" | "window"
type WebSection = "queue" | "customers" | "settings"

type SavedApp = {
  readonly name: string
  readonly url: string
  readonly mode: OpeningMode
}

const INITIAL_NAME = "客户中心"
const INITIAL_URL = "https://dashboard.northstar.example"

export function CustomAppLoadingModesPrototype() {
  const [dialogOpen, setDialogOpen] = useState(true)
  const [draftName, setDraftName] = useState(INITIAL_NAME)
  const [draftUrl, setDraftUrl] = useState(INITIAL_URL)
  const [draftMode, setDraftMode] = useState<OpeningMode | null>(null)
  const [savedApp, setSavedApp] = useState<SavedApp | null>(null)
  const [scene, setScene] = useState<PrototypeScene>("launcher")
  const [webHistory, setWebHistory] = useState<WebSection[]>(["queue"])
  const [webHistoryIndex, setWebHistoryIndex] = useState(0)
  const [isReloading, setIsReloading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const currentWebSection = webHistory[webHistoryIndex] ?? "queue"
  const canCreate = Boolean(draftName.trim() && draftUrl.trim() && draftMode)

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const resetWebHistory = () => {
    setWebHistory(["queue"])
    setWebHistoryIndex(0)
  }

  const openSavedApp = (app: SavedApp) => {
    resetWebHistory()
    setScene(app.mode === "iframe" ? "embedded" : "window")
  }

  const openCreator = () => {
    setDraftMode(null)
    setDialogOpen(true)
  }

  const createApp = () => {
    if (!canCreate || !draftMode) return
    const app: SavedApp = {
      name: draftName.trim(),
      url: draftUrl.trim(),
      mode: draftMode,
    }
    setSavedApp(app)
    setDialogOpen(false)
    setToast(draftMode === "window" ? "已创建并在新窗口打开" : "已在应用内打开")
    openSavedApp(app)
  }

  const reloadWebPage = () => {
    setIsReloading(true)
    window.setTimeout(() => setIsReloading(false), 650)
  }

  const openInBrowser = () => {
    setToast("已交给系统浏览器打开")
  }

  const navigateWeb = (section: WebSection) => {
    const nextHistory = [...webHistory.slice(0, webHistoryIndex + 1), section]
    setWebHistory(nextHistory)
    setWebHistoryIndex(nextHistory.length - 1)
  }

  const goBack = () => {
    setWebHistoryIndex((index) => Math.max(0, index - 1))
  }

  const goForward = () => {
    setWebHistoryIndex((index) => Math.min(webHistory.length - 1, index + 1))
  }

  const activeDockApp = scene === "embedded" || scene === "window" ? "custom" : "launcher"

  return (
    <div className="relative h-dvh min-h-[720px] overflow-hidden bg-surface text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <WindowChrome title="Synapse AI Studio 1.0.103 dev" />
        <div className="flex min-h-0 flex-1">
          <Dock
            activeApp={activeDockApp}
            savedApp={savedApp}
            onOpenLauncher={() => setScene("launcher")}
            onOpenCustomApp={() => savedApp && openSavedApp(savedApp)}
          />
          <main className="min-w-0 flex-1 overflow-hidden">
            {scene === "embedded" && savedApp ? (
              <EmbeddedApp
                app={savedApp}
                currentSection={currentWebSection}
                isReloading={isReloading}
                onNavigate={navigateWeb}
                onOpenBrowser={openInBrowser}
                onReload={reloadWebPage}
              />
            ) : (
              <LauncherScreen
                savedApp={savedApp}
                onCreate={openCreator}
                onOpenSavedApp={openSavedApp}
              />
            )}
          </main>
        </div>
      </div>

      {scene === "window" && savedApp ? (
        <DetachedAppWindow
          app={savedApp}
          canGoBack={webHistoryIndex > 0}
          canGoForward={webHistoryIndex < webHistory.length - 1}
          currentSection={currentWebSection}
          isReloading={isReloading}
          onBack={goBack}
          onClose={() => setScene("launcher")}
          onForward={goForward}
          onNavigate={navigateWeb}
          onOpenBrowser={openInBrowser}
          onReload={reloadWebPage}
        />
      ) : null}

      <CreateAppDialog
        canCreate={canCreate}
        mode={draftMode}
        name={draftName}
        open={dialogOpen}
        url={draftUrl}
        onModeChange={setDraftMode}
        onNameChange={setDraftName}
        onOpenChange={setDialogOpen}
        onSubmit={createApp}
        onUrlChange={setDraftUrl}
      />

      {toast ? <PrototypeToast>{toast}</PrototypeToast> : null}
    </div>
  )
}

function LauncherScreen({
  onCreate,
  onOpenSavedApp,
  savedApp,
}: {
  readonly onCreate: () => void
  readonly onOpenSavedApp: (app: SavedApp) => void
  readonly savedApp: SavedApp | null
}) {
  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="hidden w-44 shrink-0 flex-col border-r bg-sidebar p-2 sm:flex">
        <div className="relative p-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="搜索应用" aria-label="搜索应用" />
        </div>
        <nav className="mt-2 grid gap-1" aria-label="应用分类">
          <CategoryButton active icon={<LayoutDashboard />} label="全部应用" />
          <CategoryButton icon={<ListTodo />} label="已固定" />
          <CategoryButton icon={<Globe2 />} label="自定义应用" />
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-5 py-4 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">应用</h1>
            <Button type="button" onClick={onCreate}>
              <Plus />
              新建自定义应用
            </Button>
          </div>

          <section className="mt-6">
            <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">系统应用</h2>
            <div className="divide-y rounded-lg border bg-card">
              <LauncherRow icon={MessageSquare} name="Agent" />
              <LauncherRow icon={Cloud} name="云盘" />
              <LauncherRow icon={Settings} name="设置" />
            </div>
          </section>

          <section className="mt-6">
            <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">自定义应用</h2>
            {savedApp ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => onOpenSavedApp(savedApp)}
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <Globe2 className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{savedApp.name}</span>
                    <Badge variant="outline">
                      {savedApp.mode === "iframe" ? "应用内嵌" : "独立窗口"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{savedApp.url}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-5 py-9 text-center">
                <div className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <Globe2 className="size-4.5" />
                </div>
                <p className="text-sm text-muted-foreground">暂无自定义应用</p>
                <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                  <Plus />
                  新建自定义应用
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function CategoryButton({
  active = false,
  icon,
  label,
}: {
  readonly active?: boolean
  readonly icon: ReactNode
  readonly label: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "justify-start gap-2 px-2",
        active && "bg-selected text-foreground hover:bg-selected",
      )}
    >
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      {label}
    </Button>
  )
}

function LauncherRow({
  icon: Icon,
  name,
}: {
  readonly icon: typeof MessageSquare
  readonly name: string
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-3">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-sm font-medium">{name}</span>
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </div>
  )
}

function Dock({
  activeApp,
  onOpenCustomApp,
  onOpenLauncher,
  savedApp,
}: {
  readonly activeApp: "launcher" | "custom"
  readonly onOpenCustomApp: () => void
  readonly onOpenLauncher: () => void
  readonly savedApp: SavedApp | null
}) {
  const apps = [
    { id: "agent", label: "对话", icon: MessageSquare },
    { id: "drive", label: "云盘", icon: Cloud },
    { id: "automation", label: "自动化", icon: Timer },
    { id: "terminal", label: "终端", icon: PanelTop },
    { id: "settings", label: "设置", icon: Settings },
    { id: "mail", label: "邮箱", icon: Mail },
    { id: "mail-internal", label: "站内信", icon: MailOpen },
    { id: "todos", label: "待办事项", icon: ListTodo },
  ]

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r bg-sidebar py-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <AppWindow className="size-4" />
      </div>
      <nav className="mt-2 flex flex-col items-center gap-1" aria-label="Dock">
        {apps.map(({ icon: Icon, id, label }) => (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground"
            aria-label={label}
            title={label}
          >
            <Icon />
          </Button>
        ))}
        <div className="my-1 w-6 border-t" />
        {savedApp ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn(
              "text-muted-foreground",
              activeApp === "custom" && "bg-selected text-foreground hover:bg-selected",
            )}
            aria-label={savedApp.name}
            aria-current={activeApp === "custom" ? "page" : undefined}
            title={savedApp.name}
            onClick={onOpenCustomApp}
          >
            <Globe2 />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className={cn(
            "text-muted-foreground",
            activeApp === "launcher" && "bg-selected text-foreground hover:bg-selected",
          )}
          aria-label="应用"
          aria-current={activeApp === "launcher" ? "page" : undefined}
          title="应用"
          onClick={onOpenLauncher}
        >
          <LayoutDashboard />
        </Button>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2">
        <Button type="button" variant="ghost" size="icon-lg" aria-label="通知" title="通知">
          <Bell />
        </Button>
        <div className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium" aria-label="账号">
          李
        </div>
      </div>
    </aside>
  )
}

function CreateAppDialog({
  canCreate,
  mode,
  name,
  open,
  url,
  onModeChange,
  onNameChange,
  onOpenChange,
  onSubmit,
  onUrlChange,
}: {
  readonly canCreate: boolean
  readonly mode: OpeningMode | null
  readonly name: string
  readonly open: boolean
  readonly url: string
  readonly onModeChange: (mode: OpeningMode) => void
  readonly onNameChange: (name: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: () => void
  readonly onUrlChange: (url: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>新建自定义应用</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-4">
            <div className="grid content-start gap-2">
              <Label>图标</Label>
              <button
                type="button"
                className="grid size-12 place-items-center rounded-lg border bg-secondary text-secondary-foreground transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label="更换应用图标"
              >
                <Globe2 className="size-5" />
              </button>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="prototype-app-name">名称</Label>
                <Input
                  id="prototype-app-name"
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prototype-app-url">网址</Label>
                <Input
                  id="prototype-app-url"
                  value={url}
                  onChange={(event) => onUrlChange(event.target.value)}
                />
              </div>
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">打开方式</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeOption
                description="通过 iframe 在主窗口内加载。部分网站会禁止嵌入，可能出现空白、登录失败、弹窗或跨站 Cookie 受限。"
                icon={PanelTop}
                selected={mode === "iframe"}
                title="应用内嵌"
                warning
                onSelect={() => onModeChange("iframe")}
              />
              <ModeOption
                description="始终打开专用窗口，网页直接加载，不占用主窗口。"
                icon={AppWindow}
                selected={mode === "window"}
                title="独立窗口"
                onSelect={() => onModeChange("window")}
              />
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!canCreate}
            onClick={onSubmit}
          >
            {mode === "window" ? "创建并在新窗口打开" : mode === "iframe" ? "创建并打开" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeOption({
  description,
  icon: Icon,
  onSelect,
  selected,
  title,
  warning = false,
}: {
  readonly description: string
  readonly icon: typeof PanelTop
  readonly onSelect: () => void
  readonly selected: boolean
  readonly title: string
  readonly warning?: boolean
}) {
  return (
    <label
      className={cn(
        "flex min-h-[142px] cursor-pointer flex-col rounded-lg border p-3 transition-colors",
        selected
          ? "border-foreground bg-muted/50"
          : "border-border bg-background hover:bg-muted/30",
      )}
    >
      <input
        type="radio"
        name="custom-app-opening-mode"
        className="sr-only"
        checked={selected}
        onChange={onSelect}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{title}</span>
              {warning ? <Badge variant="outline">可能受限</Badge> : null}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-input bg-background",
          )}
          aria-hidden="true"
        >
          {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{description}</p>
      {warning ? (
        <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5 shrink-0" />
          页面空白或无法登录时，请改用独立窗口。
        </p>
      ) : (
        <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <CircleHelp className="size-3.5 shrink-0" />
          点击应用时只打开新窗口。
        </p>
      )}
    </label>
  )
}

function EmbeddedApp({
  app,
  currentSection,
  isReloading,
  onNavigate,
  onOpenBrowser,
  onReload,
}: {
  readonly app: SavedApp
  readonly currentSection: WebSection
  readonly isReloading: boolean
  readonly onNavigate: (section: WebSection) => void
  readonly onOpenBrowser: () => void
  readonly onReload: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <SystemAppTopBar
        left={(
          <div className="flex min-w-0 items-center gap-2">
            <Globe2 className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-sm font-semibold">{app.name}</h2>
            <Badge variant="outline">应用内嵌</Badge>
          </div>
        )}
        actions={(
          <>
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              aria-label="后退"
              tooltip="iframe 模式无法读取网页导航历史"
              disabled
            >
              <ArrowLeft />
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              aria-label="前进"
              tooltip="iframe 模式无法读取网页导航历史"
              disabled
            >
              <ArrowRight />
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              aria-label="刷新"
              tooltip="刷新"
              onClick={onReload}
            >
              <RotateCw className={cn(isReloading && "animate-spin motion-reduce:animate-none")} />
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              aria-label="在浏览器打开"
              tooltip="在浏览器打开"
              onClick={onOpenBrowser}
            >
              <ExternalLink />
            </SystemAppTopBarActionButton>
          </>
        )}
      />
      <div className="min-h-0 flex-1">
        <FakeWebApp
          activeSection={currentSection}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

function DetachedAppWindow({
  app,
  canGoBack,
  canGoForward,
  currentSection,
  isReloading,
  onBack,
  onClose,
  onForward,
  onNavigate,
  onOpenBrowser,
  onReload,
}: {
  readonly app: SavedApp
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly currentSection: WebSection
  readonly isReloading: boolean
  readonly onBack: () => void
  readonly onClose: () => void
  readonly onForward: () => void
  readonly onNavigate: (section: WebSection) => void
  readonly onOpenBrowser: () => void
  readonly onReload: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/10 p-5">
      <div className="flex h-[min(760px,calc(100dvh-40px))] w-[min(1180px,calc(100dvw-40px))] flex-col overflow-hidden rounded-xl bg-background shadow-2xl ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
        <WindowChrome title={`Synapse AI Studio · ${app.name}`} onClose={onClose} />
        <SystemAppTopBar
          left={(
            <div className="flex min-w-0 items-center gap-2">
              <Globe2 className="size-4 shrink-0 text-muted-foreground" />
              <h2 className="truncate text-sm font-semibold">{app.name}</h2>
            </div>
          )}
          actions={(
            <>
              <SystemAppTopBarActionButton
                iconOnly
                type="button"
                aria-label="后退"
                tooltip="后退"
                disabled={!canGoBack}
                onClick={onBack}
              >
                <ArrowLeft />
              </SystemAppTopBarActionButton>
              <SystemAppTopBarActionButton
                iconOnly
                type="button"
                aria-label="前进"
                tooltip="前进"
                disabled={!canGoForward}
                onClick={onForward}
              >
                <ArrowRight />
              </SystemAppTopBarActionButton>
              <SystemAppTopBarActionButton
                iconOnly
                type="button"
                aria-label="刷新"
                tooltip="刷新"
                onClick={onReload}
              >
                <RotateCw className={cn(isReloading && "animate-spin motion-reduce:animate-none")} />
              </SystemAppTopBarActionButton>
              <SystemAppTopBarActionButton
                iconOnly
                type="button"
                aria-label="在浏览器打开"
                tooltip="在浏览器打开"
                onClick={onOpenBrowser}
              >
                <ExternalLink />
              </SystemAppTopBarActionButton>
            </>
          )}
        />
        <div className="min-h-0 flex-1">
          <FakeWebApp
            activeSection={currentSection}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </div>
  )
}

function FakeWebApp({
  activeSection,
  onNavigate,
}: {
  readonly activeSection: WebSection
  readonly onNavigate: (section: WebSection) => void
}) {
  const navigation = [
    { id: "queue" as const, label: "支持队列", icon: Inbox, count: 24 },
    { id: "customers" as const, label: "客户目录", icon: Users },
    { id: "settings" as const, label: "工作区设置", icon: Settings2 },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b bg-background px-5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Globe2 className="size-4" />
          </div>
          <span className="font-semibold">Northstar</span>
        </div>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="网页主导航">
          <Button type="button" variant="secondary" size="sm">服务台</Button>
          <Button type="button" variant="ghost" size="sm">报表</Button>
          <Button type="button" variant="ghost" size="sm">知识库</Button>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="搜索网页">
            <Search />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="网页通知">
            <Bell />
          </Button>
          <div className="ml-1 grid size-7 place-items-center rounded-full bg-secondary text-xs font-medium" aria-label="当前用户">
            林
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-48 shrink-0 border-r bg-background p-2 md:flex md:flex-col">
          <div className="grid gap-1">
            {navigation.map(({ count, icon: Icon, id, label }) => (
              <Button
                key={id}
                type="button"
                variant="ghost"
                className={cn(
                  "justify-start gap-2 px-2",
                  activeSection === id && "bg-selected text-foreground hover:bg-selected",
                )}
                onClick={() => onNavigate(id)}
              >
                <Icon className="text-muted-foreground" />
                {label}
                {count ? (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
                ) : null}
              </Button>
            ))}
          </div>
          <div className="mt-auto border-t pt-2">
            <Button type="button" variant="ghost" className="w-full justify-start gap-2 px-2">
              <UserRound className="text-muted-foreground" />
              团队空间
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-5 lg:p-6">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">客户成功 / 支持台</p>
                <h3 className="mt-1 text-2xl font-semibold">
                  {activeSection === "queue"
                    ? "支持队列"
                    : activeSection === "customers"
                      ? "客户目录"
                      : "工作区设置"}
                </h3>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm">
                  <MoreHorizontal />
                  更多
                </Button>
                <Button type="button" size="sm">
                  <Plus />
                  新建工单
                </Button>
              </div>
            </div>

            {activeSection === "queue" ? <SupportQueue /> : null}
            {activeSection === "customers" ? <CustomerDirectory /> : null}
            {activeSection === "settings" ? <WorkspaceSettings /> : null}
          </div>
        </main>
      </div>
    </div>
  )
}

function SupportQueue() {
  const tickets = [
    { id: "SUP-1048", customer: "远山科技", subject: "同步任务停留在 92%", priority: "高", updated: "3 分钟前" },
    { id: "SUP-1047", customer: "一页工作室", subject: "无法重新发送邀请邮件", priority: "普通", updated: "18 分钟前" },
    { id: "SUP-1046", customer: "白昼设计", subject: "导出账单缺少公司名称", priority: "普通", updated: "42 分钟前" },
    { id: "SUP-1045", customer: "柏舟数据", subject: "请求增加只读成员", priority: "低", updated: "1 小时前" },
  ]

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 divide-x border-y py-3">
        <div className="pr-4">
          <dt className="text-xs text-muted-foreground">等待中</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">18</dd>
        </div>
        <div className="px-4">
          <dt className="text-xs text-muted-foreground">处理中</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">6</dd>
        </div>
        <div className="pl-4">
          <dt className="text-xs text-muted-foreground">今日已解决</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">31</dd>
        </div>
      </dl>

      <div className="mt-5 overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h4 className="font-medium">最近工单</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">按更新时间排序</p>
          </div>
          <Button type="button" variant="ghost" size="sm">
            查看全部
            <ArrowRight />
          </Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_80px_88px] border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>工单</span>
          <span className="hidden sm:block">客户</span>
          <span>优先级</span>
          <span className="text-right">更新时间</span>
        </div>
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_80px_88px] items-center border-b px-4 py-3 text-sm last:border-b-0"
          >
            <div className="min-w-0 pr-3">
              <p className="truncate font-medium">{ticket.subject}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{ticket.id}</p>
            </div>
            <span className="hidden truncate text-muted-foreground sm:block">{ticket.customer}</span>
            <Badge variant={ticket.priority === "高" ? "destructive" : "secondary"}>
              {ticket.priority}
            </Badge>
            <span className="text-right text-xs text-muted-foreground">{ticket.updated}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function CustomerDirectory() {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h4 className="font-medium">全部客户</h4>
        <Badge variant="secondary">128 个账号</Badge>
      </div>
      {["远山科技", "一页工作室", "白昼设计", "柏舟数据"].map((name, index) => (
        <div key={name} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
          <div className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium">
            {name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">企业版 · {index + 2} 位成员</p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </div>
      ))}
    </div>
  )
}

function WorkspaceSettings() {
  return (
    <div className="mt-5 grid gap-5 rounded-lg border bg-background p-5">
      <div className="grid gap-1">
        <h4 className="font-medium">工作区名称</h4>
        <p className="text-xs text-muted-foreground">显示在客户邮件和共享页面中。</p>
      </div>
      <Input value="Northstar 客户成功" readOnly aria-label="工作区名称" />
      <div className="flex items-center justify-between border-t pt-4">
        <div>
          <p className="font-medium">允许成员邀请客户</p>
          <p className="mt-0.5 text-xs text-muted-foreground">仅管理员可以关闭此选项。</p>
        </div>
        <Badge variant="secondary">已开启</Badge>
      </div>
    </div>
  )
}

function WindowChrome({
  onClose,
  title,
}: {
  readonly onClose?: () => void
  readonly title: string
}) {
  return (
    <div className="flex h-8 shrink-0 items-center border-b bg-background px-3">
      <div className="flex items-center gap-1.5">
        {onClose ? (
          <button
            type="button"
            className="size-3 rounded-full bg-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="关闭窗口"
            onClick={onClose}
          />
        ) : (
          <span className="size-3 rounded-full bg-destructive/70" aria-hidden="true" />
        )}
        <span className="size-3 rounded-full bg-chart-4/80" aria-hidden="true" />
        <span className="size-3 rounded-full bg-chart-3/80" aria-hidden="true" />
      </div>
      <span className="mx-auto truncate text-xs font-medium text-muted-foreground">{title}</span>
      <span className="w-12 shrink-0" aria-hidden="true" />
    </div>
  )
}

function PrototypeToast({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-md animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none"
      role="status"
    >
      {children}
    </div>
  )
}

export default CustomAppLoadingModesPrototype

createRoot(document.getElementById("custom-app-loading-prototype")!).render(
  <CustomAppLoadingModesPrototype />,
)
