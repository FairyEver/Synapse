import { useCallback, useSyncExternalStore } from "react"
import type {
  RepositoryAddOptions,
  RepositoryManager,
  RepositoryOperationState,
} from "@/app-shell/repository-manager"
import { useRepositoryManager as useRepositoryManagerContext } from "@/app-shell/repository"
import type { SynapseRepositoryConfig } from "@/types/config"
import type {
  SynapseContentMeta,
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateContentPayload,
  SynapseCreateContentRequest,
  SynapseDeleteContentPayload,
  SynapseUpdateContentPayload,
} from "@/types/content"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapsePendingPushState,
  SynapseRepositoryInitializationResult,
  SynapseRepositoryOperationResult,
} from "@/types/repository"

// ===== useRepositoryManager =====

function useRepositoryManager(): RepositoryManager {
  return useRepositoryManagerContext()
}

function useRepositorySubscription<T>(getSnapshot: (manager: RepositoryManager) => T): T {
  const manager = useRepositoryManager()

  return useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => getSnapshot(manager),
  )
}

// ===== useContentList =====

type UseContentListResult<T extends SynapseContentType> = {
  items: SynapseContentMeta<T>[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
  createContent: <P extends SynapseCreateContentPayload<T>>(
    payload: P,
  ) => Promise<SynapseContentMutationResult>
  updateContent: <P extends SynapseUpdateContentPayload<T>>(
    payload: P,
  ) => Promise<SynapseContentMutationResult>
  deleteContent: (payload: SynapseDeleteContentPayload) => Promise<SynapseContentMutationResult>
}

function useContentList<T extends SynapseContentType>(contentType: T): UseContentListResult<T> {
  const manager = useRepositoryManager()

  // 使用 useSyncExternalStore 订阅内容变更
  const store = useSyncExternalStore(
    (callback) => manager.subscribeToContentChanges(contentType, callback),
    () => manager.getContentSnapshot(contentType) as { items: SynapseContentMeta<T>[]; isLoading: boolean; error: Error | null },
  )

  const refresh = useCallback(async () => {
    await manager.refreshContentList(contentType)
  }, [manager, contentType])

  const createContent = useCallback(
    async (payload: SynapseCreateContentPayload<T>) => {
      return manager.createContent(contentType, payload)
    },
    [manager, contentType],
  )

  const updateContent = useCallback(
    async (payload: SynapseUpdateContentPayload<T>) => {
      return manager.updateContent(contentType, payload)
    },
    [manager, contentType],
  )

  const deleteContent = useCallback(
    async (payload: SynapseDeleteContentPayload) => {
      return manager.deleteContent(payload)
    },
    [manager],
  )

  return {
    items: store.items,
    isLoading: store.isLoading,
    error: store.error,
    refresh,
    createContent,
    updateContent,
    deleteContent,
  }
}

// ===== useActiveRepository =====

function useActiveRepository() {
  const activeRepository = useRepositorySubscription((manager) => manager.getActiveRepository())

  return activeRepository
}

function useRepositoryList(): SynapseRepositoryConfig[] {
  return useRepositorySubscription((manager) => manager.getRepositories())
}

function useHasRepositories(): boolean {
  return useRepositorySubscription((manager) => manager.hasRepositories())
}

function useActiveRepositoryState() {
  const activeRepository = useActiveRepository()
  return useRepositoryState(activeRepository?.uuid ?? "")
}

// ===== useRepositoryState =====

function useRepositoryState(uuid: string) {
  const manager = useRepositoryManager()

  const state = useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => manager.getRepositoryState(uuid),
  )

  return state
}

// ===== useRepositoryOperation =====

function useRepositoryOperation(uuid: string): RepositoryOperationState | undefined {
  const manager = useRepositoryManager()

  const operation = useSyncExternalStore(
    (callback) =>
      manager.subscribeToOperationChanges(uuid, () => {
        callback()
      }),
    () => manager.getOperationState(uuid),
  )

  return operation
}

// ===== usePendingPushes =====

function usePendingPushes(uuid: string): SynapsePendingPushState | undefined {
  return useRepositorySubscription((manager) => manager.getPendingPushes(uuid))
}

function useHasRunningRepositoryOperation(): boolean {
  return useRepositorySubscription((manager) => {
    return Array.from(manager.getAllOperations().values()).some((operation) => operation.isRunning)
  })
}

// ===== useRepositoryActions =====

function useRepositoryActions() {
  const manager = useRepositoryManager()

  const addRepository = useCallback(
    async (repository: SynapseRepositoryConfig, options?: RepositoryAddOptions) => {
      await manager.addRepository(repository, options)
    },
    [manager],
  )

  const removeRepository = useCallback(
    async (uuid: string) => {
      await manager.removeRepository(uuid)
    },
    [manager],
  )

  const updateRepository = useCallback(
    async (uuid: string, patch: Partial<SynapseRepositoryConfig>) => {
      await manager.updateRepository(uuid, patch)
    },
    [manager],
  )

  const replaceRepositories = useCallback(
    async (repositories: SynapseRepositoryConfig[], activeRepoUuid: string | null) => {
      await manager.replaceRepositories(repositories, activeRepoUuid)
    },
    [manager],
  )

  const setActiveRepository = useCallback(
    async (uuid: string) => {
      await manager.setActiveRepository(uuid)
    },
    [manager],
  )

  const clearActiveRepository = useCallback(async () => {
    await manager.clearActiveRepository()
  }, [manager])

  const switchActiveRepository = useCallback(
    async (uuid: string) => {
      await manager.switchActiveRepository(uuid)
    },
    [manager],
  )

  const createLocalRepositoryAndAdd = useCallback(
    async (
      options: SynapseCreateLocalRepositoryPayload,
      addOptions?: RepositoryAddOptions,
    ): Promise<SynapseCreateLocalRepositoryResult> => {
      return manager.createLocalRepositoryAndAdd(options, addOptions)
    },
    [manager],
  )

  const syncRepository = useCallback(
    async (uuid: string): Promise<SynapseRepositoryOperationResult> => {
      return manager.syncRepository(uuid)
    },
    [manager],
  )

  const pushRepository = useCallback(
    async (uuid: string): Promise<SynapseRepositoryOperationResult> => {
      return manager.pushRepository(uuid)
    },
    [manager],
  )

  const runMaintenance = useCallback(
    async (uuid: string): Promise<SynapseRepositoryOperationResult> => {
      return manager.runMaintenance(uuid)
    },
    [manager],
  )

  const initializeRepository = useCallback(
    async (uuid: string): Promise<SynapseRepositoryInitializationResult> => {
      return manager.initializeRepository(uuid)
    },
    [manager],
  )

  const refreshRepositoryStates = useCallback(async () => {
    await manager.refreshRepositoryStates()
  }, [manager])

  return {
    addRepository,
    clearActiveRepository,
    createLocalRepositoryAndAdd,
    initializeRepository,
    pushRepository,
    refreshRepositoryStates,
    removeRepository,
    replaceRepositories,
    runMaintenance,
    setActiveRepository,
    switchActiveRepository,
    syncRepository,
    updateRepository,
  }
}

export {
  useRepositoryManager,
  useContentList,
  useActiveRepository,
  useActiveRepositoryState,
  useHasRepositories,
  useHasRunningRepositoryOperation,
  useRepositoryActions,
  useRepositoryList,
  useRepositoryState,
  useRepositoryOperation,
  usePendingPushes,
}
