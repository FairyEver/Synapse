import { useCallback, useSyncExternalStore } from "react"
import type { RepositoryManager, RepositoryOperationState } from "@/app-shell/repository-manager"
import { useRepositoryManager as useRepositoryManagerContext } from "@/app-shell/repository"
import type { SynapseConfigPatch, SynapseRepositoryConfig } from "@/types/config"
import type {
  SynapseContentMeta,
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateContentPayload,
  SynapseDeleteContentPayload,
  SynapseUpdateContentPayload,
} from "@/types/content"
import type { SynapsePendingPushState } from "@/types/repository"

// ===== useRepositoryManager =====

function useRepositoryManager(): RepositoryManager {
  return useRepositoryManagerContext()
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
  const manager = useRepositoryManager()

  const activeRepository = useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => manager.getActiveRepository(),
  )

  const switchRepository = useCallback(
    async (uuid: string) => {
      await manager.switchActiveRepository(uuid)
    },
    [manager],
  )

  return {
    activeRepository,
    switchRepository,
  }
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
  const manager = useRepositoryManager()

  const pendingPushes = useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => manager.getPendingPushes(uuid),
  )

  return pendingPushes
}

// ===== useRepositoryConfig =====

function useRepositoryConfig() {
  const manager = useRepositoryManager()
  const config = useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => manager.getConfig(),
  )

  const updateConfig = useCallback(
    async (patch: SynapseConfigPatch, reset?: boolean) => {
      await manager.updateConfig(patch, reset)
    },
    [manager],
  )

  const addRepository = useCallback(
    async (repository: SynapseRepositoryConfig) => {
      await manager.addRepository(repository)
    },
    [manager],
  )

  const removeRepository = useCallback(
    async (uuid: string) => {
      await manager.removeRepository(uuid)
    },
    [manager],
  )

  return {
    config,
    updateConfig,
    addRepository,
    removeRepository,
  }
}

export {
  useRepositoryManager,
  useContentList,
  useActiveRepository,
  useRepositoryState,
  useRepositoryOperation,
  usePendingPushes,
  useRepositoryConfig,
}
