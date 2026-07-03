import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useHasRunningRepositoryOperation,
  useRepositoryList,
  useRepositoryManager,
} from "@/app-shell/use-repository-manager"
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
import { useSyncExternalStore } from "react"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositoryLocalState } from "@/types/repository"

const logger = createRendererLogger("app.repository-switch")

function useRepositoryStatesMap(repositories: SynapseRepositoryConfig[]) {
  const manager = useRepositoryManager()
  const snapshotRef = useRef<Map<string, SynapseRepositoryLocalState | undefined> | null>(null)

  return useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => {
      const prev = snapshotRef.current
      let changed = prev === null || prev.size !== repositories.length
      if (!changed) {
        for (const repo of repositories) {
          if (prev!.get(repo.uuid) !== manager.getRepositoryState(repo.uuid)) {
            changed = true
            break
          }
        }
      }
      if (changed) {
        const map = new Map<string, SynapseRepositoryLocalState | undefined>()
        for (const repo of repositories) {
          map.set(repo.uuid, manager.getRepositoryState(repo.uuid))
        }
        snapshotRef.current = map
      }
      return snapshotRef.current!
    },
  )
}

function QuickRepositorySwitchDialog() {
  const repositories = useRepositoryList()
  const activeRepository = useActiveRepository()
  const {
    closeRepositorySwitchDialog,
    isRepositorySwitchDialogOpen,
    isSwitchingRepository,
    switchingRepositoryUuid,
    switchActiveRepository,
  } = useActiveRepositorySwitch()
  const { error: showError } = useAppNotifications()

  const hasRunningRepositoryOperation = useHasRunningRepositoryOperation()
  const repositoryStates = useRepositoryStatesMap(repositories)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    if (deferredSearchQuery) {
      logger.info("Repository switch search changed.", { query: deferredSearchQuery })
    }
  }, [deferredSearchQuery])

  useEffect(() => {
    if (!isRepositorySwitchDialogOpen) {
      setSearchQuery("")
    }
  }, [isRepositorySwitchDialogOpen])

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
        <CommandInput placeholder="搜索仓库..." value={searchQuery} onValueChange={setSearchQuery} />
        <CommandList>
          <CommandEmpty>没有找到匹配的仓库。</CommandEmpty>
          <CommandGroup heading="仓库">
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepository?.uuid
              const isSwitchingCurrentRepository = switchingRepositoryUuid === repository.uuid
              const repoState = repositoryStates.get(repository.uuid)
              const isMissing = repoState?.status === "missing"
              const isInaccessible = repoState?.status === "inaccessible"
              const isUnavailable = isMissing || isInaccessible
              const isDisabled = isActive || hasRunningRepositoryOperation || isSwitchingRepository || isUnavailable
              const isBlockedByOperation =
                !isActive
                && !isUnavailable
                && !isSwitchingCurrentRepository
                && (hasRunningRepositoryOperation || isSwitchingRepository)

              return (
                <CommandItem
                  key={repository.uuid}
                  value={`${repository.name} ${repository.localPath}`}
                  data-track="repository-switch-item"
                  data-checked={isActive ? true : undefined}
                  disabled={isDisabled}
                  className="items-start"
                  onSelect={() => {
                    if (isDisabled) {
                      return
                    }

                    logger.info("Repository switch selected.", {
                      repositoryUuid: repository.uuid,
                      repositoryName: repository.name,
                    })

                    void switchActiveRepository(repository.uuid)
                      .then((didSwitch) => {
                        if (didSwitch) {
                          closeRepositorySwitchDialog()
                        }
                      })
                      .catch((error) => {
                        logger.error("Repository switch failed.", {
                          error,
                          repositoryUuid: repository.uuid,
                        })
                        showError(error instanceof Error ? error.message : "切换失败")
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
                      {isMissing ? (
                        <Badge variant="destructive">目录不存在</Badge>
                      ) : null}
                      {isInaccessible ? (
                        <Badge variant="destructive">无法访问</Badge>
                      ) : null}
                      {isBlockedByOperation ? (
                        <Badge variant="outline">操作中</Badge>
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
