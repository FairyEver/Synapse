import { useState } from "react"
import { ModuleHero, ModuleNote, ModulePanel } from "@/components/module-layout"
import { Button } from "@/components/ui/button"

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
  const draftCount = ruleItems.filter((rule) => rule.status === "草稿").length
  const backlogCount = ruleItems.filter((rule) => rule.status === "待整理").length
  const selectedCategoryLabel = categoryOptions.find((category) => category.id === selectedCategory)?.label ?? "全部"

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <ModuleHero
        actions={
          <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,22rem)_auto]">
            <input
              className="field-control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索规则名、摘要或目录"
            />
            <div className="status-pill justify-center">当前命中 {visibleRules.length} 条规则</div>
          </div>
        }
        description="把规则目录、状态和摘要整理成更安静的阅读视图，先让检索与筛选路径足够清楚。"
        eyebrow="Rules"
        metrics={[
          {
            label: "规则总数",
            value: ruleItems.length,
            description: "覆盖工程、协作和发布三类目录。",
          },
          {
            label: "已发布",
            value: publishedCount,
            description: "可以直接给团队使用的稳定规则。",
          },
          {
            label: "待整理",
            value: draftCount + backlogCount,
            description: "仍需要继续打磨的草稿与收敛项。",
          },
        ]}
        title="管理团队规则与共享约定"
      />

      <div className="flex flex-wrap gap-2">
        {categoryOptions.map((category) => {
          const isActive = category.id === selectedCategory

          return (
            <Button
              key={category.id}
              size="pill"
              type="button"
              variant={isActive ? "default" : "secondary"}
              onClick={() => setSelectedCategory(category.id)}
            >
              {category.label}
            </Button>
          )
        })}

        <Button size="pill" type="button" variant={draftOnly ? "default" : "secondary"} onClick={() => setDraftOnly((current) => !current)}>
          {draftOnly ? "仅看草稿中" : "显示全部状态"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_20rem]">
        <ModulePanel
          action={<span>{visibleRules.length} / {ruleItems.length}</span>}
          description="当前列表基于本地样例数据，重点是让规则浏览路径和信息层级先变得稳定。"
          title="规则列表"
        >
          {visibleRules.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleRules.map((rule) => (
                <article key={rule.title} className="surface-note bg-card px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="eyebrow">{rule.label}</div>
                      <h3 className="font-editorial text-[1.3rem] leading-tight text-foreground">{rule.title}</h3>
                    </div>
                    <span className="status-pill">{rule.status}</span>
                  </div>

                  <p className="mt-4 text-sm leading-7 text-muted-foreground">{rule.summary}</p>

                  <div className="mt-5 rounded-[14px] bg-secondary px-3 py-2 font-mono text-[0.8rem] text-muted-foreground">
                    {rule.path}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="surface-note surface-note-muted px-5 py-6 text-sm leading-7 text-muted-foreground">
              没有匹配当前筛选的规则，试着清空关键词或切回全部分类。
            </div>
          )}
        </ModulePanel>

        <div className="grid gap-4">
          <ModuleNote title="当前筛选">
            <dl className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>分类</dt>
                <dd className="text-foreground">{selectedCategoryLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>状态范围</dt>
                <dd className="text-foreground">{draftOnly ? "仅草稿" : "全部"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>关键词</dt>
                <dd className="max-w-[10rem] truncate text-foreground">{query.trim() || "未填写"}</dd>
              </div>
            </dl>
          </ModuleNote>

          <ModuleNote title="状态说明" tone="muted">
            <div className="space-y-4 text-sm leading-6 text-muted-foreground">
              <p>
                <span className="status-pill mr-2">已发布</span>
                可直接在团队协作中使用。
              </p>
              <p>
                <span className="status-pill mr-2">草稿</span>
                结构已成型，但还需要补全细节。
              </p>
              <p>
                <span className="status-pill mr-2">待整理</span>
                代表已有方向，但还没有完成收敛。
              </p>
            </div>
          </ModuleNote>
        </div>
      </div>
    </div>
  )
}
