import { useMemo } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

function QuickRepositorySwitchDialog() {
  const { config } = useAppConfig()
  const { operations } = useRepositoryManager()
  const {
    closeRepositorySwitchDialog,
    isRepositorySwitchDialogOpen,
    isSwitchingRepository,
    switchingRepositoryUuid,
    switchActiveRepository,
  } = useActiveRepositorySwitch()

  const hasRunningRepositoryOperation = useMemo(
    () => Object.values(operations).some((operation) => operation.isRunning),
    [operations],
  )

  return (
    <CommandDialog
      open={isRepositorySwitchDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeRepositorySwitchDialog()
        }
      }}
      title="切换仓库"
      className="sm:max-w-lg"
    >
      <Command>
        <CommandInput placeholder="搜索仓库..." />
        <CommandList>
          <CommandEmpty>没有找到匹配的仓库。</CommandEmpty>
          <CommandGroup heading="仓库">
            {config.repositories.map((repository) => {
              const isActive = repository.uuid === config.activeRepoUuid
              const isSwitchingCurrentRepository = switchingRepositoryUuid === repository.uuid
              const isDisabled = isActive || hasRunningRepositoryOperation || isSwitchingRepository

              return (
                <CommandItem
                  key={repository.uuid}
                  value={`${repository.name} ${repository.localPath}`}
                  data-checked={isActive ? true : undefined}
                  disabled={isDisabled}
                  className="items-start"
                  onSelect={() => {
                    if (isDisabled) {
                      return
                    }

                    void switchActiveRepository(repository.uuid).then((didSwitch) => {
                      if (didSwitch) {
                        closeRepositorySwitchDialog()
                      }
                    })
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{repository.name}</span>
                      {isActive ? <Badge variant="secondary">当前</Badge> : null}
                      {isSwitchingCurrentRepository ? (
                        <Badge variant="outline">切换中</Badge>
                      ) : null}
                    </div>
                    <span className="break-all text-muted-foreground">
                      {repository.localPath}
                    </span>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export { QuickRepositorySwitchDialog }
