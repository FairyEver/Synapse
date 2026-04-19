import { useMemo } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type QuickRepositorySwitchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function QuickRepositorySwitchDialog({
  open,
  onOpenChange,
}: QuickRepositorySwitchDialogProps) {
  const { config } = useAppConfig()
  const { operations } = useRepositoryManager()
  const {
    isSwitchingRepository,
    switchingRepositoryUuid,
    switchActiveRepository,
  } = useActiveRepositorySwitch()

  const hasRunningRepositoryOperation = useMemo(
    () => Object.values(operations).some((operation) => operation.isRunning),
    [operations],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>切换仓库</DialogTitle>
          <DialogDescription>选择要切到的本地目录。</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-xl border">
          {config.repositories.map((repository) => {
            const isActive = repository.uuid === config.activeRepoUuid
            const isDisabled = isActive || hasRunningRepositoryOperation || isSwitchingRepository

            return (
              <div
                key={repository.uuid}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{repository.name}</p>
                    {isActive ? <Badge variant="secondary">当前</Badge> : null}
                  </div>
                  <p className="mt-1 break-all text-sm text-muted-foreground">
                    {repository.localPath}
                  </p>
                </div>

                <Button
                  variant={isActive ? "secondary" : "outline"}
                  size="sm"
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) {
                      return
                    }

                    void switchActiveRepository(repository.uuid).then((didSwitch) => {
                      if (didSwitch) {
                        onOpenChange(false)
                      }
                    })
                  }}
                >
                  {switchingRepositoryUuid === repository.uuid ? "切换中..." : isActive ? "当前目录" : "切换"}
                </Button>
              </div>
            )
          })}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

export { QuickRepositorySwitchDialog }
