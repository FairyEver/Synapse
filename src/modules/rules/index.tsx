import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"

function RulesModule() {
  const { activeRepository } = useAppConfig()
  const { states } = useRepositoryManager()
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const description = activeRepository
    ? activeRepositoryState?.status === "ready"
      ? `当前激活仓库：${activeRepository.name}`
      : `当前激活仓库：${activeRepository.name}。本地缓存还没准备好，先到 Settings 完成浅克隆，或直接点击右上角刷新。`
    : "还没有激活仓库。先在 Settings 里添加一个 Git 仓库。"

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>列表浏览、搜索、分类筛选和创建流程会在后续步骤继续接入。</p>
            <p>当前先保留独立模块入口，让壳层和 Settings 的状态边界稳定下来。</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { RulesModule }
