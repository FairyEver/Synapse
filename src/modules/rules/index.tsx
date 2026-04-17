import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type RuleCategory = "all" | "engineering" | "collaboration" | "release"

type RuleItem = {
  title: string
  category: Exclude<RuleCategory, "all">
  label: string
  path: string
  summary: string
  status: "已发布" | "草稿" | "待整理"
}

const categoryOptions: Array<{ id: RuleCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "engineering", label: "工程" },
  { id: "collaboration", label: "协作" },
  { id: "release", label: "发布" },
]

const ruleItems: RuleItem[] = [
  {
    title: "commit-message",
    category: "engineering",
    label: "工程规范",
    path: "rules/engineering/commit-message",
    summary: "统一团队提交信息结构，便于追踪变更、生成发布日志和自动化分析。",
    status: "已发布",
  },
  {
    title: "pr-review-tone",
    category: "collaboration",
    label: "协作约定",
    path: "rules/collaboration/pr-review-tone",
    summary: "约束 Code Review 的反馈语气，帮助团队在高频迭代里保持清晰与友好。",
    status: "草稿",
  },
  {
    title: "release-checklist",
    category: "release",
    label: "发布流程",
    path: "rules/release/release-checklist",
    summary: "定义发版前确认项、回滚预案和沟通节奏，减少上线前的遗漏风险。",
    status: "已发布",
  },
  {
    title: "ai-output-fact-check",
    category: "engineering",
    label: "工程规范",
    path: "rules/engineering/ai-output-fact-check",
    summary: "要求生成式内容在出稿前完成事实核验与敏感信息排查，降低误导性输出。",
    status: "待整理",
  },
  {
    title: "async-handbook-sync",
    category: "collaboration",
    label: "协作约定",
    path: "rules/collaboration/async-handbook-sync",
    summary: "规定异步协作中的文档同步节奏，让会议结论能够快速沉淀回团队知识库。",
    status: "已发布",
  },
]

const inputClassName =
  "h-11 w-full rounded-2xl border border-border/70 bg-white/90 px-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"

export function RulesModule() {
  const [query, setQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<RuleCategory>("all")
  const [draftOnly, setDraftOnly] = useState(false)

  const visibleRules = ruleItems.filter((rule) => {
    const matchesCategory = selectedCategory === "all" || rule.category === selectedCategory
    const matchesDraft = !draftOnly || rule.status === "草稿"
    const searchableText = `${rule.title} ${rule.label} ${rule.summary} ${rule.path}`.toLowerCase()
    const matchesQuery = query.trim().length === 0 || searchableText.includes(query.trim().toLowerCase())

    return matchesCategory && matchesDraft && matchesQuery
  })

  const publishedCount = ruleItems.filter((rule) => rule.status === "已发布").length

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <section className="overflow-hidden rounded-[30px] border border-white/80 bg-white/72 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.25fr_0.75fr] lg:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-primary uppercase">
              Rules Module
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
                团队规则的浏览壳层已经就位
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                这里先承接列表浏览、搜索和创建入口的布局骨架。后续步骤会把 Git 仓库读取、分类统计和详情弹窗逐步接进来。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className={inputClassName}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索规则名、摘要或目录..."
              />
              <Button className="h-11 rounded-2xl px-5" variant="outline">
                新建 Rule
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {categoryOptions.map((category) => {
                const isActive = category.id === selectedCategory

                return (
                  <button
                    key={category.id}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                      isActive
                        ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                        : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    {category.label}
                  </button>
                )
              })}

              <button
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                  draftOnly
                    ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                )}
                type="button"
                onClick={() => setDraftOnly((current) => !current)}
              >
                仅看草稿
              </button>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(244,248,246,0.96),rgba(235,241,238,0.92))] p-4 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[22px] border border-white/70 bg-white/86 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">当前规则数</div>
              <div className="mt-3 text-3xl font-semibold text-foreground">{ruleItems.length}</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">覆盖工程、协作、发布三类目录。</p>
            </div>

            <div className="rounded-[22px] border border-white/70 bg-white/86 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">已发布占比</div>
              <div className="mt-3 text-3xl font-semibold text-foreground">{publishedCount}</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">为后续统计卡片和筛选体系预留位置。</p>
            </div>

            <div className="rounded-[22px] border border-white/70 bg-white/86 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">状态保留</div>
              <div className="mt-3 text-lg font-semibold text-foreground">切换 Tab 再回来试试</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">这里输入的搜索词和筛选项会继续保留。</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.45fr_0.55fr]">
        <div className="rounded-[30px] border border-border/70 bg-white/76 p-5 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">规则列表占位视图</h2>
              <p className="text-sm text-muted-foreground">当前列表使用本地 mock 数据，后续会改为仓库实际内容。</p>
            </div>
            <div className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
              命中 {visibleRules.length} 条
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {visibleRules.map((rule) => (
              <article
                key={rule.title}
                className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,248,244,0.86))] p-5 transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_14px_40px_-26px_rgba(15,23,42,0.35)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{rule.label}</div>
                    <h3 className="mt-2 text-lg font-semibold text-foreground">{rule.title}</h3>
                  </div>
                  <span className="rounded-full border border-border/70 bg-white/80 px-2.5 py-1 text-xs text-muted-foreground">
                    {rule.status}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-muted-foreground">{rule.summary}</p>

                <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-background/75 px-3 py-2 text-xs text-muted-foreground">
                  {rule.path}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="grid gap-4">
          <section className="rounded-[30px] border border-border/70 bg-white/76 p-5 backdrop-blur">
            <h2 className="text-lg font-semibold text-foreground">当前模块边界</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Rules 模块先只关心自己的搜索状态、列表占位和创建入口，不直接引用 Skills 或 Settings 的业务逻辑。
            </p>
          </section>

          <section className="rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(222,241,236,0.92),rgba(255,248,230,0.9))] p-5">
            <h2 className="text-lg font-semibold text-foreground">下一步接入点</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              第 7、8、9、10、11 步会在这里继续接内容解析、分类统计、详情弹窗和创建流程。
            </p>
          </section>
        </aside>
      </section>
    </div>
  )
}
