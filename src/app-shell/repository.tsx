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
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapsePendingPushState,
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
  pendingPushes: Record<string, SynapsePendingPushState>
  states: Record<string, SynapseRepositoryLocalState>
  flushPendingPushes: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  refreshPendingPushes: (repositoryUuid: string) => Promise<void>
  syncRepository: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  refreshRepositoryStates: () => Promise<void>
}

const RepositoryManagerContext = createContext<RepositoryManagerContextValue | null>(null)
const logger = createRendererLogger("app.repository")

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
  const bridge = getSynapseBridge()

  if (!bridge) {
    logger.warn("Repository bridge is unavailable while reading states.")
    return repositoryUuids.map(createFallbackRepositoryState)
  }

  return bridge.repository.getStates()
}

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const { config } = useAppConfig()
  const [states, setStates] = useState<Record<string, SynapseRepositoryLocalState>>({})
  const [operations, setOperations] = useState<Record<string, RepositoryOperationState>>({})
  const [pendingPushes, setPendingPushes] = useState<Record<string, SynapsePendingPushState>>({})
  const hasRepositoryBridge = Boolean(getSynapseBridge())

  const repositoryIds = useMemo(
    () => config.repositories.map((repository) => repository.uuid),
    [config.repositories],
  )

  const refreshRepositoryStates = useCallback(async () => {
    logger.debug("Refreshing repository states.", {
      repositoryCount: repositoryIds.length,
    })
    const nextStates = await readRepositoryStates(repositoryIds)

    setStates(toStateMap(nextStates))
    logger.debug("Repository states refreshed.", {
      repositoryCount: nextStates.length,
    })
  }, [repositoryIds])

  useEffect(() => {
    const repositoryIdSet = new Set(repositoryIds)

    setStates((currentStates) => filterRecordByRepositoryIds(currentStates, repositoryIdSet))
    setOperations((currentOperations) => filterRecordByRepositoryIds(currentOperations, repositoryIdSet))
    setPendingPushes((currentPendingPushes) => filterRecordByRepositoryIds(currentPendingPushes, repositoryIdSet))
  }, [repositoryIds])

  useEffect(() => {
    logger.info("Repository bridge status resolved.", {
      hasRepositoryBridge,
    })
  }, [hasRepositoryBridge])

  useEffect(() => {
    void refreshRepositoryStates().catch((error) => {
      logger.error("Failed to refresh repository states.", error)
    })
  }, [refreshRepositoryStates])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.repository.onProgress((progressEvent) => {
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
    const unsubscribe = getSynapseBridge()?.repository.onUpdated((updatedEvent) => {
      logger.info("Received repository updated event.", updatedEvent)
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
        logger.error("Failed to refresh repository states after repository update.", error)
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [refreshRepositoryStates])

  const refreshPendingPushes = useCallback(
    async (repositoryUuid: string) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        return
      }

      const nextPendingPushes = await bridge.repository.getPendingPushes(repositoryUuid)

      setPendingPushes((currentPendingPushes) => ({
        ...currentPendingPushes,
        [repositoryUuid]: nextPendingPushes,
      }))
    },
    [],
  )

  useEffect(() => {
    if (!config.activeRepoUuid) {
      return
    }

    void refreshPendingPushes(config.activeRepoUuid).catch((error) => {
      logger.error("Failed to refresh pending pushes.", error)
    })
  }, [config.activeRepoUuid, refreshPendingPushes])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.repository.onPendingPushesUpdated((updatedEvent) => {
      setPendingPushes((currentPendingPushes) => ({
        ...currentPendingPushes,
        [updatedEvent.repositoryUuid]: updatedEvent.pendingPushes,
      }))
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const runRepositoryOperation = useCallback(
    async (repositoryUuid: string, operation: SynapseRepositoryOperationKind) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        const errorMessage = "当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。"
        logger.error("Repository operation requested without repository bridge.", {
          repositoryUuid,
          operation,
        })

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
        logger.info("Starting repository operation.", {
          repositoryUuid,
          operation,
        })
        const result =
          operation === "sync"
            ? await bridge.repository.sync(repositoryUuid)
            : await bridge.repository.flushPendingPushes(repositoryUuid)

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

        logger.info("Repository operation completed.", {
          repositoryUuid,
          operation: result.operation,
          completedAt: result.completedAt,
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git 仓库操作失败。"
        logger.error("Repository operation failed.", {
          repositoryUuid,
          operation,
          error,
        })

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
      pendingPushes,
      states,
      flushPendingPushes: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "push"),
      refreshPendingPushes,
      syncRepository: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "sync"),
      refreshRepositoryStates,
    }),
    [
      hasRepositoryBridge,
      operations,
      pendingPushes,
      refreshPendingPushes,
      refreshRepositoryStates,
      runRepositoryOperation,
      states,
    ],
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
