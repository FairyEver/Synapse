import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"

function SkillsModule() {
  const { activeRepository } = useAppConfig()
  const { states } = useRepositoryManager()
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const description = activeRepository
    ? activeRepositoryState?.status !== "ready"
      ? `当前激活目录：${activeRepository.name}。本地目录不存在，请到 Settings 里重新选择。`
      : activeRepositoryState.isGitRepository
        ? `当前激活目录：${activeRepository.name}`
        : `当前激活目录：${activeRepository.name}。当前目录不是 Git 仓库，可以浏览本地内容，但刷新和新建会禁用。`
    : "还没有激活目录。先在 Settings 里选择一个本地目录。"

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>内容扫描、详情预览、多文件流程和安装能力会在后续步骤逐步补齐。</p>
            <p>这里先保留独立模块容器，确保顶层 Tabs 切换时状态不会被销毁。</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { SkillsModule }
