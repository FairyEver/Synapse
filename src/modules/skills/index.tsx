import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SkillTarget = "all" | "cursor" | "claude" | "generic"

type SkillItem = {
  name: string
  target: Exclude<SkillTarget, "all">
  label: string
  files: number
  attachments: number
  summary: string
}

const targetOptions: Array<{ id: SkillTarget; label: string }> = [
  { id: "all", label: "全部终端" },
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude Code" },
  { id: "generic", label: "通用目录" },
]

const skillItems: SkillItem[] = [
  {
    name: "pr-summary-generator",
    target: "cursor",
    label: "Cursor",
    files: 4,
    attachments: 1,
    summary: "自动读取变更并输出结构化 PR 摘要，适合作为团队提交流程的标准技能包。",
  },
  {
    name: "release-retrospective-kit",
    target: "generic",
    label: "通用目录",
    files: 7,
    attachments: 2,
    summary: "发版后复盘模板与辅助脚本集合，便于在多个编辑器环境里复用。",
  },
  {
    name: "customer-voice-clustering",
    target: "claude",
    label: "Claude Code",
    files: 5,
    attachments: 3,
    summary: "将访谈和工单内容聚类成主题摘要，方便产品团队持续维护洞察库。",
  },
  {
    name: "onboarding-mentor-pack",
    target: "cursor",
    label: "Cursor",
    files: 3,
    attachments: 0,
    summary: "封装新人上手项目的提示词、目录规范和样例，让学习路径更顺滑。",
  },
]

const inputClassName =
  "h-11 w-full rounded-2xl border border-border/70 bg-white/90 px-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary/60 focus:ring-4 focus:ring-primary/10"

export function SkillsModule() {
  const [query, setQuery] = useState("")
  const [selectedTarget, setSelectedTarget] = useState<SkillTarget>("all")
  const [attachmentsOnly, setAttachmentsOnly] = useState(false)

  const visibleSkills = skillItems.filter((skill) => {
    const matchesTarget = selectedTarget === "all" || skill.target === selectedTarget
    const matchesAttachments = !attachmentsOnly || skill.attachments > 0
    const searchableText = `${skill.name} ${skill.summary} ${skill.label}`.toLowerCase()
    const matchesQuery = query.trim().length === 0 || searchableText.includes(query.trim().toLowerCase())

    return matchesTarget && matchesAttachments && matchesQuery
  })

  const totalFiles = skillItems.reduce((count, skill) => count + skill.files, 0)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <section className="overflow-hidden rounded-[30px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,250,248,0.96),rgba(234,242,247,0.9))] shadow-[0_24px_90px_-46px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center rounded-full border border-primary/15 bg-white/70 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-primary uppercase">
              Skills Module
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
                技能包浏览与安装入口的结构已经成型
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                这一层先承接筛选、统计和安装上下文占位。真正的内容解析、附件展示和安装流程会在后续步骤逐步接进来。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className={inputClassName}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 Skill 名称、摘要或目标环境..."
              />
              <Button className="h-11 rounded-2xl px-5" variant="outline">
                新建 Skill
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {targetOptions.map((target) => {
                const isActive = target.id === selectedTarget

                return (
                  <button
                    key={target.id}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                      isActive
                        ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                        : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setSelectedTarget(target.id)}
                  >
                    {target.label}
                  </button>
                )
              })}

              <button
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition app-no-drag",
                  attachmentsOnly
                    ? "border-primary/25 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/70 bg-white/85 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                )}
                type="button"
                onClick={() => setAttachmentsOnly((current) => !current)}
              >
                仅看带附件
              </button>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-white/70 bg-white/72 p-4 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[22px] border border-border/70 bg-background/85 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">技能数</div>
              <div className="mt-3 text-3xl font-semibold text-foreground">{skillItems.length}</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">为后续列表页、详情弹窗和下载按钮预留数据槽位。</p>
            </div>

            <div className="rounded-[22px] border border-border/70 bg-background/85 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">文件总量</div>
              <div className="mt-3 text-3xl font-semibold text-foreground">{totalFiles}</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">后续会由实际仓库解析结果和附件清单驱动。</p>
            </div>

            <div className="rounded-[22px] border border-border/70 bg-background/85 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">切换保持</div>
              <div className="mt-3 text-lg font-semibold text-foreground">筛选状态会留在这里</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">适合后面接更复杂的分页、排序和滚动位置。</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[30px] border border-border/70 bg-white/76 p-5 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">技能包列表占位</h2>
              <p className="text-sm text-muted-foreground">不同目标环境会在这里走向各自的安装适配流程。</p>
            </div>
            <div className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
              命中 {visibleSkills.length} 个 Skill
            </div>
          </div>

          <div className="grid gap-3">
            {visibleSkills.map((skill) => (
              <article
                key={skill.name}
                className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(246,248,250,0.84))] p-5 transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_14px_40px_-26px_rgba(15,23,42,0.35)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{skill.label}</div>
                    <h3 className="mt-2 text-lg font-semibold text-foreground">{skill.name}</h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/70 bg-white/80 px-2.5 py-1">{skill.files} files</span>
                    <span className="rounded-full border border-border/70 bg-white/80 px-2.5 py-1">
                      {skill.attachments} attachments
                    </span>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-muted-foreground">{skill.summary}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="grid gap-4">
          <section className="rounded-[30px] border border-border/70 bg-white/76 p-5 backdrop-blur">
            <h2 className="text-lg font-semibold text-foreground">适配器预留</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              第 16 步会在这个模块下继续细化编辑器适配器体系，把“安装到哪里”拆成独立策略层。
            </p>
          </section>

          <section className="rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(234,246,244,0.92),rgba(236,240,252,0.92))] p-5">
            <h2 className="text-lg font-semibold text-foreground">附件与下载链路</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              第 10、12、15、17 步会继续把附件预览、创建流程、下载按钮和安装系统补到这里。
            </p>
          </section>
        </aside>
      </section>
    </div>
  )
}
