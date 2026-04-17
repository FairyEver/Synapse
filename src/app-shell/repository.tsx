import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useAppConfig } from "@/app-shell/config"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
} from "@/types/repository"

type RepositoryOperationState = {
  operation: SynapseRepositoryOperationKind | null
  isRunning: boolean
  statusText: string | null
  percent: number | null
  error: string | null
  completedAt: string | null
}

type RepositoryManagerContextValue = {
  hasRepositoryBridge: boolean
  operations: Record<string, RepositoryOperationState>
  states: Record<string, SynapseRepositoryLocalState>
  syncRepository: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  refreshRepositoryStates: () => Promise<void>
}

const RepositoryManagerContext = createContext<RepositoryManagerContextValue | null>(null)

function createFallbackRepositoryState(repositoryUuid: string): SynapseRepositoryLocalState {
  return {
    repositoryUuid,
    localPath: "",
    status: "missing",
    isGitRepository: false,
    gitRootPath: null,
  }
}

function createOperationState(
  value: Partial<RepositoryOperationState> = {},
): RepositoryOperationState {
  return {
    operation: null,
    isRunning: false,
    statusText: null,
    percent: null,
    error: null,
    completedAt: null,
    ...value,
  }
}

function toStateMap(
  repositoryStates: SynapseRepositoryLocalState[],
): Record<string, SynapseRepositoryLocalState> {
  return Object.fromEntries(
    repositoryStates.map((state) => [state.repositoryUuid, state]),
  )
}

function filterRecordByRepositoryIds<T>(
  record: Record<string, T>,
  repositoryIds: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([repositoryUuid]) => repositoryIds.has(repositoryUuid)),
  )
}

async function readRepositoryStates(
  repositoryUuids: string[],
): Promise<SynapseRepositoryLocalState[]> {
  const bridge = window.synapse?.repository

  if (!bridge) {
    return repositoryUuids.map(createFallbackRepositoryState)
  }

  return bridge.getStates()
}

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const { config } = useAppConfig()
  const [states, setStates] = useState<Record<string, SynapseRepositoryLocalState>>({})
  const [operations, setOperations] = useState<Record<string, RepositoryOperationState>>({})
  const hasRepositoryBridge = Boolean(window.synapse?.repository)

  const repositoryIds = useMemo(
    () => config.repositories.map((repository) => repository.uuid),
    [config.repositories],
  )

  const refreshRepositoryStates = useCallback(async () => {
    const nextStates = await readRepositoryStates(repositoryIds)

    setStates(toStateMap(nextStates))
  }, [repositoryIds])

  useEffect(() => {
    const repositoryIdSet = new Set(repositoryIds)

    setStates((currentStates) => filterRecordByRepositoryIds(currentStates, repositoryIdSet))
    setOperations((currentOperations) => filterRecordByRepositoryIds(currentOperations, repositoryIdSet))
  }, [repositoryIds])

  useEffect(() => {
    void refreshRepositoryStates().catch((error) => {
      console.error("[repository] Failed to refresh repository states.", error)
    })
  }, [refreshRepositoryStates])

  useEffect(() => {
    const unsubscribe = window.synapse?.repository?.onProgress((progressEvent) => {
      setOperations((currentOperations) => ({
        ...currentOperations,
        [progressEvent.repositoryUuid]: createOperationState({
          ...currentOperations[progressEvent.repositoryUuid],
          operation: progressEvent.operation,
          isRunning: true,
          statusText: progressEvent.statusText,
          percent: progressEvent.percent,
          error: null,
        }),
      }))
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.synapse?.repository?.onUpdated((updatedEvent) => {
      setOperations((currentOperations) => ({
        ...currentOperations,
        [updatedEvent.repositoryUuid]: createOperationState({
          ...currentOperations[updatedEvent.repositoryUuid],
          operation: updatedEvent.operation,
          isRunning: false,
          statusText: "仓库同步完成。",
          percent: 100,
          error: null,
          completedAt: updatedEvent.completedAt,
        }),
      }))

      void refreshRepositoryStates().catch((error) => {
        console.error("[repository] Failed to refresh repository states after update.", error)
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [refreshRepositoryStates])

  const runRepositoryOperation = useCallback(
    async (repositoryUuid: string, operation: SynapseRepositoryOperationKind) => {
      const bridge = window.synapse?.repository

      if (!bridge) {
        const errorMessage = "当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。"

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation,
            isRunning: false,
            statusText: null,
            percent: null,
            error: errorMessage,
          }),
        }))

        throw new Error(errorMessage)
      }

      setOperations((currentOperations) => ({
        ...currentOperations,
        [repositoryUuid]: createOperationState({
          ...currentOperations[repositoryUuid],
          operation,
          isRunning: true,
          statusText: "正在准备同步...",
          percent: 0,
          error: null,
        }),
      }))

      try {
        const result = await bridge.sync(repositoryUuid)

        setStates((currentStates) => ({
          ...currentStates,
          [repositoryUuid]: result.repository,
        }))

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation: result.operation,
            isRunning: false,
            statusText: "仓库同步完成。",
            percent: 100,
            error: null,
            completedAt: result.completedAt,
          }),
        }))

        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git 仓库操作失败。"

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation,
            isRunning: false,
            statusText: null,
            percent: null,
            error: message,
          }),
        }))

        throw error
      }
    },
    [],
  )

  const value = useMemo<RepositoryManagerContextValue>(
    () => ({
      hasRepositoryBridge,
      operations,
      states,
      syncRepository: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "sync"),
      refreshRepositoryStates,
    }),
    [hasRepositoryBridge, operations, refreshRepositoryStates, runRepositoryOperation, states],
  )

  return (
    <RepositoryManagerContext.Provider value={value}>
      {children}
    </RepositoryManagerContext.Provider>
  )
}

function useRepositoryManager(): RepositoryManagerContextValue {
  const context = useContext(RepositoryManagerContext)

  if (!context) {
    throw new Error("useRepositoryManager must be used within RepositoryManagerProvider.")
  }

  return context
}

export {
  RepositoryManagerProvider,
  useRepositoryManager,
  type RepositoryOperationState,
}
