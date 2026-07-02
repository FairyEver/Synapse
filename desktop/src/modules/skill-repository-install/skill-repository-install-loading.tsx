import { Spinner } from "@/components/ui/spinner"

function SkillRepositoryInstallLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        正在准备安装
      </div>
    </div>
  )
}

export { SkillRepositoryInstallLoading }
