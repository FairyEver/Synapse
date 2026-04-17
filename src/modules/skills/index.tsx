import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"

function SkillsModule() {
  const { activeRepository } = useAppConfig()
  const { states } = useRepositoryManager()

  if (activeRepository === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">先选择本地目录</p>
      </div>
    )
  }

  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const description =
    activeRepositoryState?.status !== "ready"
      ? `当前目录：${activeRepository.name}。未找到本地目录，请重新选择。`
      : activeRepositoryState.isGitRepository
        ? `当前目录：${activeRepository.name}`
        : `当前目录：${activeRepository.name}。当前目录不是 Git 仓库。`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}

export { SkillsModule }
