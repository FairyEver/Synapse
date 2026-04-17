import { ChevronRight, Plus, RefreshCw, Search } from "lucide-react"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const shellTabs = [
  { label: "规则", active: true },
  { label: "技能", active: false },
  { label: "设置", active: false },
]

const sidebarGroups = [
  "全部规则",
  "代码质量",
  "安全",
  "性能",
]

const ruleCards = [
  { title: "持续化场景感知", description: "保持壳层结构稳定，让模块内容在统一的主内容区域中切换和扩展。" },
  { title: "代码审查提示", description: "为基础布局预留清晰的主次分区，让列表、详情和辅助信息都能自然承接。" },
  { title: "骨架优先", description: "先建立顶栏、侧栏和内容区的节奏，再逐步填充具体模块能力和业务状态。" },
  { title: "布局即语义", description: "用稳定的容器边界表达导航、筛选和工作区职责，减少后续页面反复重做。" },
  { title: "安全 API 默认边界", description: "把全局动作收敛在顶栏，避免业务区域与壳层能力发生耦合。" },
  { title: "上下文持久化", description: "侧栏负责范围切换和筛选，主区保留给模块内容、详情面板和结果呈现。" },
  { title: "响应式留白策略", description: "在窄屏下退化为纵向堆叠，保证骨架完整，不让功能入口丢失。" },
  { title: "任务密度控制", description: "两列主区仅作为桌面态密度参考，真正的业务组件仍由模块自己决定。" },
  { title: "主视图保护", description: "主内容区域默认保持大面积留白，让未来的数据面板和编辑器有足够空间。" },
  { title: "统一操作入口", description: "刷新、创建等全局动作靠近顶栏右侧，便于形成稳定的使用记忆。" },
]

function App() {
  const leftColumnCards = ruleCards.slice(0, 5)
  const rightColumnCards = ruleCards.slice(5)

  return (
    <AppShellLayout
      brand={
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-foreground text-[13px] font-medium leading-none text-background shadow-[rgba(0,0,0,0.08)_0px_0px_0px_1px]">
            <span className="font-mono tracking-[-0.02em]">S</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-[1.5rem] leading-none text-foreground">Synapse</p>
          </div>
        </div>
      }
      navigation={
        <nav className="flex justify-center">
          <div className="surface-border-light inline-flex flex-wrap items-center gap-1 rounded-full bg-card p-1">
            {shellTabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium leading-[1.5] transition-colors",
                  tab.active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      }
      actions={
        <Button variant="secondary" size="icon" className="size-9 rounded-[6px]">
          <RefreshCw className="size-4" />
          <span className="sr-only">刷新布局</span>
        </Button>
      }
      sidebar={
        <div className="flex h-full flex-col gap-5 p-4">
          <div className="flex items-center gap-2">
            <div className="surface-border-light flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
              <Search className="size-4 shrink-0" />
              <span className="truncate">搜索分区...</span>
            </div>
            <Button variant="outline" size="icon" className="size-9 rounded-lg">
              <Plus className="size-4" />
              <span className="sr-only">创建分区</span>
            </Button>
          </div>

          <div className="space-y-2">
            <p className="px-2 font-mono text-[12px] font-medium leading-none tracking-[0.08em] text-muted-foreground uppercase">
              分类
            </p>
            <div className="space-y-1">
              {sidebarGroups.map((group, index) => (
                <button
                  key={group}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm leading-[1.5] transition-colors",
                    index === 0
                      ? "surface-border bg-card text-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground",
                  )}
                >
                  <span>{group}</span>
                  <ChevronRight className="size-4 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <div className="h-full p-5">
        <div className="grid h-full gap-3 xl:grid-cols-2">
          <div className="space-y-3">
            {leftColumnCards.map((card) => (
              <ShellPlaceholderCard key={card.title} title={card.title} description={card.description} />
            ))}
          </div>
          <div className="space-y-3">
            {rightColumnCards.map((card) => (
              <ShellPlaceholderCard key={card.title} title={card.title} description={card.description} />
            ))}
          </div>
        </div>
      </div>
    </AppShellLayout>
  )
}

type ShellPlaceholderCardProps = {
  title: string
  description: string
}

function ShellPlaceholderCard({ title, description }: ShellPlaceholderCardProps) {
  return (
    <article className="surface-card rounded-xl bg-card px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="surface-border-light mt-1 size-5 shrink-0 rounded-full bg-background" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[15px] font-medium leading-[1.43] text-foreground">{title}</h2>
              <p className="mt-1 text-sm leading-[1.56] text-muted-foreground">{description}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 rounded-[6px]">
              查看
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}

export default App
