import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppConfig } from "@/app-shell/config"

function SkillsModule() {
  const { activeRepository } = useAppConfig()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
            <CardDescription>
              {activeRepository
                ? `当前激活仓库：${activeRepository.name}`
                : "还没有激活仓库。先在 Settings 里添加一个 Git 仓库。"}
            </CardDescription>
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
