import { useState } from "react"
import { ModuleHero, ModuleNote, ModulePanel } from "@/components/module-layout"
import { Button } from "@/components/ui/button"

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
  { id: "all", label: "全部环境" },
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
  const totalAttachments = skillItems.reduce((count, skill) => count + skill.attachments, 0)
  const selectedTargetLabel = targetOptions.find((target) => target.id === selectedTarget)?.label ?? "全部环境"

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6">
      <ModuleHero
        actions={
          <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,22rem)_auto]">
            <input
              className="field-control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能名称、摘要或目标环境"
            />
            <div className="status-pill justify-center">当前命中 {visibleSkills.length} 个技能</div>
          </div>
        }
        description="把技能目录、目标环境和附件情况整理成统一的浏览视图，让安装语义先稳定下来。"
        eyebrow="Skills"
        metrics={[
          {
            label: "技能数",
            value: skillItems.length,
            description: "统一挂在同一套目录与筛选语义下。",
          },
          {
            label: "文件总量",
            value: totalFiles,
            description: "用于估计技能包的结构复杂度。",
          },
          {
            label: "附件总量",
            value: totalAttachments,
            description: "帮助我们快速判断哪些技能附带额外资源。",
          },
        ]}
        title="整理技能包目录与安装上下文"
      />

      <div className="flex flex-wrap gap-2">
        {targetOptions.map((target) => {
          const isActive = target.id === selectedTarget

          return (
            <Button
              key={target.id}
              size="pill"
              type="button"
              variant={isActive ? "default" : "secondary"}
              onClick={() => setSelectedTarget(target.id)}
            >
              {target.label}
            </Button>
          )
        })}

        <Button
          size="pill"
          type="button"
          variant={attachmentsOnly ? "default" : "secondary"}
          onClick={() => setAttachmentsOnly((current) => !current)}
        >
          {attachmentsOnly ? "仅看带附件" : "显示全部技能"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_20rem]">
        <ModulePanel
          action={<span>{visibleSkills.length} / {skillItems.length}</span>}
          description="列表先按名称、环境和附件三层信息展开，便于快速比对不同技能包。"
          title="技能目录"
        >
          {visibleSkills.length > 0 ? (
            <div className="grid gap-3">
              {visibleSkills.map((skill) => (
                <article key={skill.name} className="surface-note bg-card px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="eyebrow">{skill.label}</div>
                      <h3 className="font-editorial text-[1.3rem] leading-tight text-foreground">{skill.name}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="status-pill">{skill.files} files</span>
                      <span className="status-pill">{skill.attachments} attachments</span>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-7 text-muted-foreground">{skill.summary}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="surface-note surface-note-muted px-5 py-6 text-sm leading-7 text-muted-foreground">
              没有匹配当前筛选的技能，试着放宽环境或附件条件。
            </div>
          )}
        </ModulePanel>

        <div className="grid gap-4">
          <ModuleNote title="当前筛选">
            <dl className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>目标环境</dt>
                <dd className="text-foreground">{selectedTargetLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>附件条件</dt>
                <dd className="text-foreground">{attachmentsOnly ? "仅带附件" : "全部"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>关键词</dt>
                <dd className="max-w-[10rem] truncate text-foreground">{query.trim() || "未填写"}</dd>
              </div>
            </dl>
          </ModuleNote>

          <ModuleNote title="目标环境分布" tone="muted">
            <dl className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <dt>Cursor</dt>
                <dd className="text-foreground">{skillItems.filter((skill) => skill.target === "cursor").length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Claude Code</dt>
                <dd className="text-foreground">{skillItems.filter((skill) => skill.target === "claude").length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>通用目录</dt>
                <dd className="text-foreground">{skillItems.filter((skill) => skill.target === "generic").length}</dd>
              </div>
            </dl>
          </ModuleNote>
        </div>
      </div>
    </div>
  )
}
